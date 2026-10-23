import { PromptName, renderTemplate, SYSTEM_NODES } from '@aw/builtin';
import {
  AppError,
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
  taskMachine,
  transition,
} from '@aw/shared';
import { BACKEND_COMMITTER, gitFailure, type RepoLocks, runGit, unmergedFiles } from '../git/index.ts';
import { acceptanceProject } from '../nodes/index.ts';
import type { Task } from './tasks.repo.ts';
import type { TaskState, TasksServiceDeps } from './tasks.state.ts';

/**
 * Merges `target` into a task worktree and leaves the conflict markers for a step to resolve (13 §4, 27 §3.6); the
 * merge stays in progress and the step's commit concludes it. Returns the conflicted files.
 */
export function mergeIntoWorktree(locks: RepoLocks, repoPath: string, dir: string, target: string): Promise<string[]> {
  return locks.run(repoPath, async () => {
    // git needs an identity even for a merge it does not commit yet; the backend's, as for every merge (D52).
    const args = [...BACKEND_COMMITTER, 'merge', '--no-ff', '--no-commit', '--end-of-options', target];
    const result = await runGit(args, { cwd: dir, okExitCodes: [0, 1] });
    const files = await unmergedFiles(dir);
    if (result.exitCode === 1 && files.length === 0) throw gitFailure(args, result);
    return files;
  });
}

/** Nodes nothing else depends on: the new step comes after all of them (13 §4). */
const leafKeys = (nodes: ReadonlyArray<{ key: string; dependsOn: readonly string[] }>) =>
  nodes.filter((n) => !nodes.some((other) => other.dependsOn.includes(n.key))).map((n) => n.key);

/**
 * Sending a task back to the AI (09 §2 `changes_requested`, 13 §4; `review_feedback`, 21 §3): a new plan version with one more step —
 * the user's requested changes, or the resolution of a conflicting merge — confirmed at once; back to `running`.
 */
export function createTaskChanges(
  deps: TasksServiceDeps,
  state: TaskState,
  currentDelivery: (taskId: string) => DeliveryDTO | null,
) {
  const { unit, prompts, projects, workflows, plans, nodes, inbox, locks } = deps;
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
    const workflow = workflows.get(task.workflowId);
    unit.transact(() => {
      const plan = plans.createDraft({
        taskId: task.id,
        source: PlanSource.User,
        graph: { nodes: [...confirmed.graph.nodes, spec] },
        summary: confirmed.summary,
        assumptions: confirmed.assumptions,
        feedback: revision.feedback,
        createdByAttemptId: null,
      });
      plans.confirm(plan.id);
      nodes.append(
        {
          taskId: task.id,
          planId: plan.id,
          ...acceptanceProject(projects.getRecord(task.projectId)),
          defaultAcceptance: workflow.definition.defaultAcceptance,
          acceptEachNode: task.checkpoints.accept_each_node,
        },
        spec,
      );
      // The task leaves review; reaching it again opens a new delivery item.
      inbox.dismissOpen({ taskId: task.id, kind: InboxKind.Delivery });
      // A completed task is not finished any more (21 §7).
      move(get(task.id), event, undefined, { currentPlanId: plan.id, finishedAt: null });
    });
  }

  return {
    async requestChanges(
      taskId: string,
      reason: RequestChangesRequest['reason'],
      feedback: string | undefined,
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
        instructions = renderTemplate(prompts[PromptName.Revise], {
          feedback,
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
      appendRevision(task, { reason, instructions, feedback: feedback ?? null }, TaskEvent.ChangesRequested);
    },

    appendRevision,
  };
}
export type TaskChangeRequests = ReturnType<typeof createTaskChanges>;
