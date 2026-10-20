import {
  AppError,
  type DeliverRequest,
  type DeliveryDTO,
  DeliveryStrategy,
  ErrorCode,
  type ErrorInfo,
  InboxKind,
  isLocalMerge,
  TaskEvent,
  TaskEventEntity,
  TaskStatus,
  taskMachine,
  transition,
  WorkflowDeliverable,
  WorktreeStatus,
} from '@aw/shared';
import { checkDeliverable, type MergeOutcome, mergeLocally, pushBranch } from '../delivery/index.ts';
import type { GitHostingProvider } from '../hosting/index.ts';
import { latestTaskEventId } from '../timeline/index.ts';
import type { Worktree } from '../worktrees/index.ts';
import type { Task } from './tasks.repo.ts';
import type { TaskState, TasksServiceDeps } from './tasks.state.ts';

const errorInfoOf = (err: unknown): ErrorInfo =>
  err instanceof AppError ? err.toInfo() : { code: ErrorCode.InternalError, message: String(err) };

/**
 * Delivering a task in review (11 §5.3, 09 §7): checks first (nothing changes when they fail), then `merging` with a
 * delivery record, the merge or pull request, and the outcome; a completed task's worktree is removed.
 */
export function createTaskDelivery(deps: TasksServiceDeps, state: TaskState) {
  const { db, unit, clock, log, settings, projects, workflows, worktrees, inbox, deliveries, locks } = deps;
  const { get, move } = state;

  /**
   * The latest delivery of the current review round (11 §5.2): made after the task last reached review. Once the AI
   * was sent back (再改改 / 解决冲突), an earlier conflict or failure no longer describes the task.
   */
  function current(taskId: string): DeliveryDTO | null {
    const delivery = deliveries.latest(taskId);
    if (delivery === undefined) return null;
    const reviewed = latestTaskEventId(db, taskId, { entity: TaskEventEntity.Task, type: TaskEvent.AllNodesFinished });
    const started = latestTaskEventId(db, taskId, {
      entity: TaskEventEntity.Delivery,
      type: 'note',
      entityId: delivery.id,
    });
    return started > reviewed ? delivery : null;
  }

  function readyWorktree(task: Task): Worktree {
    const worktree = worktrees.findByTask(task.id);
    if (worktree?.status !== WorktreeStatus.Ready) throw new Error(`Task ${task.key} in review has no worktree`);
    return worktree;
  }

  /** The task is done: its delivery item is resolved by it (11 §7). */
  function recordSuccess(taskId: string, delivery: DeliveryDTO, result: { commitSha?: string; prUrl?: string }) {
    unit.transact(() => {
      const task = get(taskId);
      const event = task.status === TaskStatus.Review ? TaskEvent.Deliver : TaskEvent.DeliverySucceeded;
      deliveries.succeed(delivery.id, result);
      move(task, event, TaskStatus.Completed, { finishedAt: clock.now() });
      inbox.resolveOpen({ taskId, kind: InboxKind.Delivery }, { deliveryId: delivery.id });
    });
  }

  /** A completed task's worktree goes (09 §2); a pull request keeps its branch, after a merge the setting decides. */
  async function cleanUp(task: Task, worktree: Worktree, strategy: DeliveryStrategy): Promise<void> {
    const deleteBranch = strategy !== DeliveryStrategy.PullRequest && settings.get('delivery.deleteBranchAfterMerge');
    try {
      await worktrees.remove(worktree, { repoPath: projects.getRecord(task.projectId).repoPath, deleteBranch });
    } catch (err) {
      // The task is delivered either way; the failure stays on the worktree (status error) for the Git console.
      if (!(err instanceof AppError)) throw err;
      log.warn({ err, taskId: task.id }, 'worktree removal after delivery failed');
    }
  }

  /** The delivery could not be made: the task goes back to review for another try (09 §7). */
  function recordFailure(taskId: string, delivery: DeliveryDTO, err: unknown): void {
    unit.transact(() => {
      deliveries.fail(delivery.id, errorInfoOf(err));
      move(get(taskId), TaskEvent.DeliveryFailed);
    });
  }

  async function mergeTask(task: Task, delivery: DeliveryDTO, worktree: Worktree, repoPath: string): Promise<void> {
    const strategy = delivery.strategy;
    if (!isLocalMerge(strategy)) throw new Error(`Strategy ${strategy} is not a local merge`);
    let outcome: MergeOutcome;
    try {
      outcome = await mergeLocally(locks, {
        repoPath,
        worktreePath: worktree.path,
        branch: worktree.branch,
        targetBranch: delivery.targetBranch,
        strategy,
        message: `${task.title} (${task.key})`,
      });
    } catch (err) {
      recordFailure(task.id, delivery, err);
      if (err instanceof AppError) return;
      throw err;
    }
    if (outcome.merged) {
      recordSuccess(task.id, delivery, { commitSha: outcome.commitSha });
      await cleanUp(task, worktree, strategy);
      return;
    }
    const { conflictFiles } = outcome;
    unit.transact(() => {
      deliveries.conflict(delivery.id, conflictFiles, {
        code: ErrorCode.DeliveryConflict,
        message: 'Merging the task branch conflicts with the target branch',
        details: { files: conflictFiles },
      });
      move(get(task.id), TaskEvent.DeliveryConflict);
    });
  }

  /** Pushes the branch and opens the pull request on the project's platform (11 §5.3). */
  async function openPullRequest(
    task: Task,
    delivery: DeliveryDTO,
    worktree: Worktree,
    hosting: GitHostingProvider,
    pr: { title: string; body: string },
  ): Promise<void> {
    let url: string;
    try {
      const { repoPath } = projects.getRecord(task.projectId);
      await pushBranch(locks, { repoPath, branch: worktree.branch, authorization: hosting.gitAuthorization() });
      ({ url } = await hosting.createPullRequest({
        head: worktree.branch,
        base: delivery.targetBranch,
        title: pr.title,
        body: pr.body,
      }));
    } catch (err) {
      recordFailure(task.id, delivery, err);
      if (err instanceof AppError) return;
      throw err;
    }
    recordSuccess(task.id, delivery, { prUrl: url });
    await cleanUp(task, worktree, delivery.strategy);
  }

  return {
    current,
    async deliver(taskId: string, request: Omit<DeliverRequest, 'id'>): Promise<void> {
      const task = get(taskId);
      transition(taskMachine, task.status, TaskEvent.Deliver, TaskStatus.Merging);
      const report = workflows.get(task.workflowId).deliverable === WorkflowDeliverable.Report;
      if (report !== (request.strategy === DeliveryStrategy.ReportOnly)) {
        throw new AppError(
          ErrorCode.ValidationFailed,
          report ? 'A report is finished with report_only' : 'report_only is for report workflows',
          { issues: [{ path: ['strategy'], message: `not allowed for this task: ${request.strategy}` }] },
        );
      }
      if (report) {
        // A report needs no merge: it is accepted as it is.
        unit.transact(() => {
          const delivery = deliveries.start({
            taskId,
            strategy: DeliveryStrategy.ReportOnly,
            targetBranch: task.baseBranch,
          });
          recordSuccess(taskId, delivery, {});
        });
        await cleanUp(task, readyWorktree(task), DeliveryStrategy.ReportOnly);
        return;
      }
      const worktree = readyWorktree(task);
      const { repoPath } = projects.getRecord(task.projectId);
      const targetBranch = request.targetBranch ?? task.baseBranch;
      await checkDeliverable({
        repoPath,
        worktreePath: worktree.path,
        targetBranch,
        checkTargetWorktree: isLocalMerge(request.strategy),
      });
      const hosting =
        request.strategy === DeliveryStrategy.PullRequest ? await projects.hostingOf(task.projectId) : undefined;
      const delivery = unit.transact(() => {
        const started = deliveries.start({ taskId, strategy: request.strategy, targetBranch });
        move(task, TaskEvent.Deliver, TaskStatus.Merging);
        return started;
      });
      if (hosting === undefined) await mergeTask(task, delivery, worktree, repoPath);
      else {
        const pr = request.pr ?? { title: task.title, body: task.result?.summary ?? '' };
        await openPullRequest(task, delivery, worktree, hosting, pr);
      }
    },

    lastDelivery: current,

    /** Startup: a delivery cut short by the previous run failed; its task waits in review for another try. */
    recover(): void {
      for (const delivery of deliveries.listRunning()) {
        unit.transact(() => {
          deliveries.fail(delivery.id, {
            code: ErrorCode.DeliveryInterrupted,
            message: 'The app stopped while the delivery ran',
          });
          move(get(delivery.taskId), TaskEvent.DeliveryFailed);
        });
      }
    },
  };
}
