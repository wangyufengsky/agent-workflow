import { PromptName, renderTemplate, SYSTEM_NODES, VERIFY_NODE } from '@aw/builtin';
import {
  AppError,
  AttachmentOwnerKind,
  ChangeRequestReason,
  type DeliveryDTO,
  DeliveryStatus,
  ErrorCode,
  InboxKind,
  NodeKind,
  type PlanNodeSpec,
  PlanSource,
  type RequestChangesRequest,
  TaskEvent,
  TaskStatus,
  taskMachine,
  transition,
} from '@aw/shared';
import { backendCommitter, gitFailure, type RepoLocks, runGit, unmergedFiles } from '../git/index.ts';
import type { Node } from '../nodes/index.ts';
import { acceptanceProject } from '../nodes/index.ts';
import type { Task } from './tasks.repo.ts';
import type { TaskState, TasksServiceDeps } from './tasks.state.ts';
import { leafKeys } from './tasks.verify.ts';

/**
 * Merges `target` into a task worktree and leaves the conflict markers for a step to resolve (13 §4, 27 §3.6); the
 * merge stays in progress and the step's commit concludes it. Returns the conflicted files.
 */
export function mergeIntoWorktree(locks: RepoLocks, repoPath: string, dir: string, target: string): Promise<string[]> {
  return locks.run(repoPath, async () => {
    // git needs an identity even for a merge it does not commit yet; the backend's, as for every merge (D52).
    const args = [...backendCommitter(), 'merge', '--no-ff', '--no-commit', '--end-of-options', target];
    const result = await runGit(args, { cwd: dir, okExitCodes: [0, 1] });
    const files = await unmergedFiles(dir);
    if (result.exitCode === 1 && files.length === 0) throw gitFailure(args, result);
    return files;
  });
}

/**
 * Sending a task back to the AI (09 §2 `changes_requested`, 13 §4; `review_feedback`, 21 §3): a new plan version with one more step —
 * the user's requested changes, or the resolution of a conflicting merge — confirmed at once; back to `running`.
 */
export function createTaskChanges(
  deps: TasksServiceDeps,
  state: TaskState,
  currentDelivery: (taskId: string) => DeliveryDTO | null,
) {
  const { unit, prompts, projects, workflows, plans, nodes, inbox, locks, browser } = deps;
  const { get, move } = state;

  /** Merges the target into the task worktree for a conflict step (13 §4); returns the conflicted files. */
  const mergeTarget = (task: Task, targetBranch: string): Promise<string[]> => {
    const ctx = state.runContext(task);
    return mergeIntoWorktree(locks, ctx.repoPath, ctx.directory, targetBranch);
  };

  function nextKey(taskId: string, prefix: string): string {
    const taken = nodes.listByTask(taskId).filter((n) => n.key.startsWith(prefix)).length;
    return `${prefix}${taken + 1}`;
  }

  /**
   * One more step after all current ones, in a new plan version confirmed at once (13 §4); the task goes back to
   * `running` with `event`. Only the new node is materialized.
   */
  function appendRevision(
    task: Task,
    revision: { reason: ChangeRequestReason; instructions: string; feedback: string | null },
    event: typeof TaskEvent.ChangesRequested | typeof TaskEvent.ReviewFeedback,
    attachmentIds: readonly string[] = [],
  ): void {
    const confirmed = plans.confirmed(task.id);
    if (confirmed === undefined) throw new Error(`Task ${task.key} has no confirmed plan`);
    const system = SYSTEM_NODES[revision.reason];
    const spec: PlanNodeSpec = {
      key: nextKey(task.id, system.keyPrefix),
      title: system.title,
      roleKey: system.roleKey,
      instructions: revision.instructions,
      dependsOn: leafKeys(confirmed.graph.nodes),
      acceptance: system.acceptance,
      kind: NodeKind.Revise,
    };
    // With a checklist, the change is verified again after it (31 §2.3).
    const check = state.verify.stepAfter(task.id, nextKey(task.id, `${VERIFY_NODE.keyPrefix}_`), [spec.key]);
    const added = check === undefined ? [spec] : [spec, check];
    unit.transact(() => {
      const [node] = appendSteps(task, added, revision.feedback, event);
      if (node === undefined) throw new Error('No step was appended');
      deps.attachments.bind({ kind: AttachmentOwnerKind.TaskFeedback, id: node.id }, attachmentIds);
    });
  }

  /**
   * Adds `added` after the current steps in a new plan version confirmed at once (13 §4), and sends the task back to
   * `running` with `event`. Only the new nodes are materialized.
   */
  function appendSteps(
    task: Task,
    added: readonly PlanNodeSpec[],
    feedback: string | null,
    event: typeof TaskEvent.ChangesRequested | typeof TaskEvent.ReviewFeedback,
  ): Node[] {
    const confirmed = plans.confirmed(task.id);
    if (confirmed === undefined) throw new Error(`Task ${task.key} has no confirmed plan`);
    const workflow = workflows.get(task.workflowId);
    return unit.transact(() => {
      const plan = plans.createDraft({
        taskId: task.id,
        source: PlanSource.User,
        graph: { nodes: [...confirmed.graph.nodes, ...added] },
        summary: confirmed.summary,
        assumptions: confirmed.assumptions,
        feedback,
        createdByAttemptId: null,
      });
      plans.confirm(plan.id);
      const input = {
        taskId: task.id,
        planId: plan.id,
        ...acceptanceProject(projects.getRecord(task.projectId)),
        defaultAcceptance: workflow.definition.defaultAcceptance,
        acceptEachNode: task.checkpoints.accept_each_node,
      };
      const appended = added.map((spec) => nodes.append(input, spec));
      // The task leaves review; reaching it again opens a new delivery item.
      inbox.dismissOpen({ taskId: task.id, kind: InboxKind.Delivery });
      // A completed task is not finished any more (21 §7), nor archived (D219).
      move(get(task.id), event, undefined, { currentPlanId: plan.id, finishedAt: null, archivedAt: null });
      return appended;
    });
  }

  return {
    /** 「重新核验」(31 §2.3): one more verify step after everything, for a task in review. */
    reverifyRequirements(taskId: string): void {
      const task = get(taskId);
      if (task.status !== TaskStatus.Review) {
        throw new AppError(ErrorCode.RequirementsNotEditable, `Task ${task.key} is not waiting for review`, {
          status: task.status,
        });
      }
      const confirmed = plans.confirmed(task.id);
      if (confirmed === undefined) throw new Error(`Task ${task.key} has no confirmed plan`);
      const step = state.verify.stepAfter(
        task.id,
        nextKey(task.id, `${VERIFY_NODE.keyPrefix}_`),
        leafKeys(confirmed.graph.nodes),
      );
      if (step === undefined) {
        throw new AppError(ErrorCode.ValidationFailed, `Task ${task.key} has no checklist`, {
          issues: [{ path: ['id'], message: 'the task has no acceptance checklist' }],
        });
      }
      appendSteps(task, [step], null, TaskEvent.ChangesRequested);
    },

    async requestChanges(
      taskId: string,
      reason: RequestChangesRequest['reason'],
      feedback: string | undefined,
      attachmentIds: readonly string[] = [],
      page?: RequestChangesRequest['page'],
    ): Promise<void> {
      const task = get(taskId);
      transition(taskMachine, task.status, TaskEvent.ChangesRequested);
      let instructions: string;
      if (reason === ChangeRequestReason.User) {
        if (feedback === undefined) {
          throw new AppError(ErrorCode.ValidationFailed, 'Asking for changes needs feedback', {
            issues: [{ path: ['feedback'], message: 'required when reason is user' }],
          });
        }
        // The page the user looked at goes with the feedback, read from their own tab (29 §2.3).
        const withPage = page === undefined ? feedback : `${feedback}\n\n${browser.pageNote(taskId, page.tabId)}`;
        instructions = renderTemplate(prompts[PromptName.Revise], {
          feedback: withPage,
          resultSummary: task.result?.summary ?? '',
        });
      } else {
        const delivery = currentDelivery(taskId);
        if (delivery?.status !== DeliveryStatus.Conflict) {
          throw new AppError(ErrorCode.ValidationFailed, 'The last delivery did not conflict', {
            issues: [{ path: ['reason'], message: 'conflict needs a conflicting delivery' }],
          });
        }
        const files = await mergeTarget(task, delivery.targetBranch);
        instructions = renderTemplate(prompts[PromptName.ReviseConflict], {
          targetBranch: delivery.targetBranch,
          files: files.map((f) => `- \`${f}\``).join('\n'),
        });
      }
      appendRevision(
        task,
        { reason, instructions, feedback: feedback ?? null },
        TaskEvent.ChangesRequested,
        attachmentIds,
      );
    },

    appendRevision,
  };
}
export type TaskChangeRequests = ReturnType<typeof createTaskChanges>;
