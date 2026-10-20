import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PromptName, renderTemplate } from '@aw/builtin';
import {
  AppError,
  acceptanceResponseSchema,
  ErrorCode,
  FailureAction,
  failureResponseSchema,
  type InboxItemDTO,
  InboxKind,
  isTerminalState,
  permissionResponseSchema,
  planResponseSchema,
  questionAnswerSchema,
  taskMachine,
} from '@aw/shared';
import { parseInput } from '../../core/http/errors.ts';
import type { TaskLifecycle } from './tasks.lifecycle.ts';
import type { TaskState, TasksServiceDeps } from './tasks.state.ts';

/**
 * Decisions taken in「需要你处理」(11 §7): each kind acts through the module owning the action, which resolves the
 * item. Also node decisions and project deletion, which need the task around them.
 */
export function createTaskActions(deps: TasksServiceDeps, state: TaskState, lifecycle: TaskLifecycle) {
  const { inbox, attempts, nodes, roles, prompts, projects, dataDir } = deps;

  function attemptOf(item: InboxItemDTO): string {
    if (item.attemptId === null) throw new Error(`${item.kind} item ${item.id} has no attempt`);
    return item.attemptId;
  }
  function taskOf(item: InboxItemDTO): string {
    if (item.taskId === null) throw new Error(`${item.kind} item ${item.id} has no task`);
    return item.taskId;
  }

  async function acceptNode(taskId: string, nodeId: string) {
    // The node must belong to the task whose worktree is committed (NODE_NOT_FOUND otherwise, before any change).
    nodes.detail(taskId, nodeId);
    return nodes.accept(nodeId, state.runContext(state.get(taskId)));
  }

  return {
    acceptNode,

    async resolveInbox(id: string, response: unknown): Promise<InboxItemDTO> {
      const item = inbox.requireOpen(id);
      switch (item.kind) {
        case InboxKind.Question: {
          const { answer } = parseInput(questionAnswerSchema, response);
          const attemptId = attemptOf(item);
          // The answer goes to the session right away when it waits for it: that needs opencode.
          if (!attempts.isReady()) throw new AppError(ErrorCode.OpencodeNotReady, 'opencode is not ready');
          inbox.resolve(item, { answer });
          const roleId = attempts.roleIdOf(attemptId);
          if (roleId === null) throw new Error(`Attempt ${attemptId} has no role`);
          const role = roles.get(roleId);
          await attempts.deliverAnswer(
            attemptId,
            renderTemplate(prompts[PromptName.StartAnswer], { question: item.payload.question, answer }),
            { agent: role.baseAgent, system: role.prompt },
          );
          break;
        }
        case InboxKind.Permission: {
          const { decision } = parseInput(permissionResponseSchema, response);
          const attemptId = attemptOf(item);
          // opencode first: if it cannot take the reply, the item stays open for another try.
          await attempts.replyPermission(item.payload, decision);
          inbox.resolve(item, { decision });
          attempts.resumeIfAnswered(attemptId);
          break;
        }
        case InboxKind.Acceptance: {
          const decision = parseInput(acceptanceResponseSchema, response);
          if (item.nodeId === null) throw new Error(`Acceptance item ${item.id} has no node`);
          if (decision.accepted) await acceptNode(taskOf(item), item.nodeId);
          else if (decision.feedback === undefined) {
            throw new AppError(ErrorCode.ValidationFailed, 'Rejecting a step needs feedback', {
              issues: [{ path: ['response', 'feedback'], message: 'required when not accepted' }],
            });
          } else nodes.reject(item.nodeId, decision.feedback);
          break;
        }
        case InboxKind.Plan: {
          const decision = parseInput(planResponseSchema, response);
          // The draft under review may be the user's edit of the item's version (M5-01).
          const draft = deps.plans.draft(taskOf(item));
          if (draft === undefined) throw new Error(`Plan item ${item.id} has no draft to confirm`);
          if ('confirmed' in decision) lifecycle.confirmPlan(taskOf(item), draft.version);
          else lifecycle.replan(taskOf(item), decision.replanFeedback);
          break;
        }
        case InboxKind.Failure: {
          const { action } = parseInput(failureResponseSchema, response);
          if (action === FailureAction.Retry) lifecycle.retry(taskOf(item));
          else {
            inbox.resolve(item, { action });
            await lifecycle.cancel(taskOf(item), false);
          }
          break;
        }
        case InboxKind.Delivery:
          throw new AppError(ErrorCode.ValidationFailed, 'A delivery item is resolved by merging or opening a PR', {
            kind: item.kind,
          });
      }
      return inbox.get(id);
    },

    /** A custom workflow goes; the versions tasks use stay for them, unlisted (11 §4). */
    deleteWorkflow(key: string): void {
      deps.workflows.remove(key, (ids) => state.repo.workflowsInUse(ids));
    },

    /** A custom role goes unless a listed workflow names it or a task step or session used it (ROLE_IN_USE). */
    deleteRole(id: string): void {
      roles.delete(id, (role) => {
        const workflows = deps.workflows.usingRole(role.key);
        const usedByTasks = nodes.usesRole(role.id) || attempts.usesRole(role.id);
        return workflows.length > 0 || usedByTasks ? { workflows, usedByTasks } : null;
      });
    },

    /** Deleting a project deletes its finished tasks and their records (10 §5). */
    async deleteProject(projectId: string): Promise<void> {
      projects.getRecord(projectId);
      const tasks = state.repo.list({ projectId });
      const active = tasks.filter((t) => !isTerminalState(taskMachine, t.status));
      if (active.length > 0) {
        throw new AppError(ErrorCode.ProjectHasActiveTasks, 'Finish or cancel the project tasks first', {
          tasks: active.map((t) => t.key),
        });
      }
      deps.unit.transact(() => {
        state.repo.deleteByProject(projectId);
        projects.delete(projectId);
      });
      await Promise.all(tasks.map((t) => rm(join(dataDir, 'runs', t.id), { recursive: true, force: true })));
    },
  };
}
