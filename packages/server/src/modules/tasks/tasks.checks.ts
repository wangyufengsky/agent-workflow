import {
  AcceptanceCheckKind,
  AppError,
  ErrorCode,
  type NodeAcceptance,
  NodeStatus,
  TaskFailedPhase,
  TaskStatus,
} from '@aw/shared';
import type { TaskLifecycle } from './tasks.lifecycle.ts';
import type { TaskState, TasksServiceDeps } from './tasks.state.ts';

type CommandCheck = Extract<NodeAcceptance['checks'][number], { kind: typeof AcceptanceCheckKind.Command }>;

/** Steps a change to the checks still reaches: not started yet, or failed and about to go on. */
const UNFINISHED: readonly NodeStatus[] = [NodeStatus.Pending, NodeStatus.Ready, NodeStatus.Failed];

/**
 * A failed task's ways out when a check command stopped it (D115): replace the command, or skip it when the app's
 * environment cannot run it, in the task's unfinished steps (their acceptance was frozen when the plan was
 * confirmed, 13 §1); then the task goes on and the submitted results are checked again.
 */
export function createTaskChecks(deps: TasksServiceDeps, state: TaskState, lifecycle: TaskLifecycle) {
  const { unit, nodes, projects } = deps;

  /** The command check a task failed in running stopped on. */
  function failedCheck(taskId: string) {
    const task = state.get(taskId);
    const running = task.status === TaskStatus.Failed && task.failedPhase === TaskFailedPhase.Running;
    const check = running
      ? nodes
          .listByTask(taskId)
          .map(nodes.failedCommand)
          .find((c) => c !== null)
      : undefined;
    if (check === undefined) {
      throw new AppError(ErrorCode.StateTransitionInvalid, `Task ${task.key} did not fail on a check command`, {
        taskId,
      });
    }
    return { task, check };
  }

  function rewrite(taskId: string, command: string, change: (check: CommandCheck) => CommandCheck) {
    for (const node of nodes.listByTask(taskId).filter((n) => UNFINISHED.includes(n.status))) {
      if (!node.acceptance.checks.some((c) => c.kind === AcceptanceCheckKind.Command && c.command === command))
        continue;
      const checks = node.acceptance.checks.map((c) =>
        c.kind === AcceptanceCheckKind.Command && c.command === command ? change(c) : c,
      );
      nodes.setAcceptance(node.id, { ...node.acceptance, checks });
    }
  }

  return {
    /** The new command replaces the failed one; steps that submitted a result are checked again with it. */
    async updateCheckCommand(taskId: string, command: string, updateProject: boolean): Promise<void> {
      const { task, check } = failedCheck(taskId);
      if (updateProject) await projects.update({ id: task.projectId, checkCommand: command });
      unit.transact(() => {
        rewrite(taskId, check.command, () => ({ kind: AcceptanceCheckKind.Command, command }));
        lifecycle.retry(taskId, (node) => nodes.failedCommand(node) !== null);
      });
    },

    /** Only a check that could not run: the steps go on without it, and the result card says so. */
    skipCheck(taskId: string): void {
      const { task, check } = failedCheck(taskId);
      if (check.unrunnable === null) {
        throw new AppError(ErrorCode.StateTransitionInvalid, `Task ${task.key}'s check ran; it cannot be skipped`, {
          taskId,
        });
      }
      unit.transact(() => {
        rewrite(taskId, check.command, (c) => ({ ...c, skipped: true }));
        lifecycle.retry(taskId);
      });
    },
  };
}
