import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PromptName, renderTemplate } from '@aw/builtin';
import {
  AppError,
  AttachmentOwnerKind,
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
  ServerEventType,
  TASK_STATUSES,
  taskMachine,
  WorktreeStatus,
} from '@aw/shared';
import { parseInput } from '../../core/http/errors.ts';
import type { TaskLifecycle } from './tasks.lifecycle.ts';
import type { Task } from './tasks.repo.ts';
import type { TaskState, TasksServiceDeps } from './tasks.state.ts';

/**
 * Decisions taken in「需要你处理」(11 §7): each kind acts through the module owning the action, which resolves the
 * item. Also node decisions and project deletion, which need the task around them.
 */
export function createTaskActions(deps: TasksServiceDeps, state: TaskState, lifecycle: TaskLifecycle) {
  const { inbox, attempts, nodes, roles, prompts, projects, dataDir } = deps;
  /** Modules above tasks that keep rows of a project outside its foreign keys (initiatives' attachments, 34 §9). */
  const projectDeletion: Array<(projectId: string) => void> = [];
  /** Modules above tasks whose records need the task to stay (batches, initiatives, D222): what holds it, or null. */
  const deletionGuards: Array<(taskId: string) => Record<string, string> | null> = [];
  const finishedStatuses = TASK_STATUSES.filter((s) => isTerminalState(taskMachine, s));

  /** Archiving and deleting are for tasks whose work is over (D218, D221). */
  function finished(taskId: string): Task {
    const task = state.get(taskId);
    if (!isTerminalState(taskMachine, task.status)) {
      throw new AppError(ErrorCode.TaskNotFinished, `Task ${task.key} has not finished`, { status: task.status });
    }
    return task;
  }

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
          await attempts.replyPermission(attemptId, item.payload, decision);
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
        case InboxKind.ScheduleFailure:
          throw new AppError(ErrorCode.ValidationFailed, 'A schedule failure is resolved by resuming the schedule', {
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

    archive(taskId: string): void {
      if (finished(taskId).archivedAt !== null) return;
      state.repo.setArchived(taskId, deps.clock.now());
      state.publish(taskId);
    },
    unarchive(taskId: string): void {
      if (state.get(taskId).archivedAt === null) return;
      state.repo.setArchived(taskId, null);
      state.publish(taskId);
    },
    /** Archives the finished tasks of a project, or of every project, that are not archived yet (D220). */
    archiveFinished({ projectId }: { projectId?: string | undefined }): { archived: number } {
      if (projectId !== undefined) projects.getRecord(projectId);
      const ids = state.repo.unarchivedIn(projectId, finishedStatuses);
      deps.unit.transact(() => {
        state.repo.archiveAll(ids, deps.clock.now());
        for (const id of ids) state.publish(id);
      });
      return { archived: ids.length };
    },

    /**
     * Deletes a finished task with its records (foreign keys cascade), attachments and `runs/<taskId>/`, and a worktree
     * left over from a failed removal; the branch, commits and pull request stay (D221).
     */
    async deleteTask(taskId: string): Promise<void> {
      const task = finished(taskId);
      for (const guard of deletionGuards) {
        const holder = guard(taskId);
        if (holder !== null) {
          throw new AppError(ErrorCode.TaskInUse, `Task ${task.key} belongs to a batch or an initiative`, holder);
        }
      }
      const worktree = deps.worktrees.findByTask(taskId);
      if (worktree?.status === WorktreeStatus.Error) {
        await deps.worktrees.remove(worktree, {
          repoPath: projects.getRecord(task.projectId).repoPath,
          deleteBranch: false,
        });
      }
      const nodeIds = nodes.listByTask(taskId).map((n) => n.id);
      deps.unit.transact(() => {
        deps.attachments.release(AttachmentOwnerKind.TaskInput, [taskId]);
        deps.attachments.release(AttachmentOwnerKind.TaskFeedback, nodeIds);
        state.repo.delete(taskId);
        deps.unit.publish({ type: ServerEventType.TaskDeleted, data: { taskId, projectId: task.projectId } });
      });
      await rm(join(dataDir, 'runs', taskId), { recursive: true, force: true });
    },
    /** A module whose records name tasks says which task it holds (D222); called before a task is deleted. */
    guardDeletion(guard: (taskId: string) => Record<string, string> | null): void {
      deletionGuards.push(guard);
    },

    /** Deleting a project deletes its finished tasks, its knowledge conversations and their records (10 §5). */
    async deleteProject(projectId: string): Promise<void> {
      projects.getRecord(projectId);
      deps.knowledge.assertProjectIdle(projectId);
      deps.gitReviews.assertProjectIdle(projectId);
      const tasks = state.repo.list({ projectId });
      const active = tasks.filter((t) => !isTerminalState(taskMachine, t.status));
      if (active.length > 0) {
        throw new AppError(ErrorCode.ProjectHasActiveTasks, 'Finish or cancel the project tasks first', {
          tasks: active.map((t) => t.key),
        });
      }
      const nodeIds = tasks.flatMap((t) => nodes.listByTask(t.id).map((n) => n.id));
      deps.unit.transact(() => {
        deps.attachments.release(
          AttachmentOwnerKind.TaskInput,
          tasks.map((t) => t.id),
        );
        deps.attachments.release(AttachmentOwnerKind.TaskFeedback, nodeIds);
        state.repo.deleteByProject(projectId);
        deps.knowledge.deleteByProject(projectId);
        deps.gitReviews.deleteByProject(projectId);
        for (const listener of projectDeletion) listener(projectId);
        projects.delete(projectId);
      });
      await Promise.all(tasks.map((t) => rm(join(dataDir, 'runs', t.id), { recursive: true, force: true })));
    },
    /** Called inside the deleting transaction, before the project row goes. */
    onProjectDeleted(listener: (projectId: string) => void): void {
      projectDeletion.push(listener);
    },
  };
}
