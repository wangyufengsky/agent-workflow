import {
  AcceptanceCheckKind,
  AppError,
  ErrorCode,
  type NodeAcceptance,
  NodeStatus,
  TaskFailedPhase,
  TaskStatus,
} from '@aw/shared';
import type { Node } from '../nodes/index.ts';
import type { TaskLifecycle } from './tasks.lifecycle.ts';
import type { Task } from './tasks.repo.ts';
import type { TaskState, TasksServiceDeps } from './tasks.state.ts';

type Check = NodeAcceptance['checks'][number];

/** Steps a change to the checks still reaches: not started yet, or failed and about to go on. */
const UNFINISHED: readonly NodeStatus[] = [NodeStatus.Pending, NodeStatus.Ready, NodeStatus.Failed];

/**
 * A failed task's ways out when a check stopped it (D116): replace the check command, or skip a check the app's
 * environment cannot run (a command, or the page check whose preview never started, 29 §7.4), in the task's
 * unfinished steps (their acceptance was frozen when the plan was confirmed, 13 §1); then the task goes on and the
 * submitted results are checked again.
 */
export function createTaskChecks(deps: TasksServiceDeps, state: TaskState, lifecycle: TaskLifecycle) {
  const { unit, nodes, projects } = deps;

  /** What the failed steps of a task that failed in running stopped on (`find`), or a state error. */
  function failedOn<T>(taskId: string, find: (node: Node) => T | null, what: string): { task: Task; found: T } {
    const task = state.get(taskId);
    const running = task.status === TaskStatus.Failed && task.failedPhase === TaskFailedPhase.Running;
    const found = running
      ? nodes
          .listByTask(taskId)
          .map(find)
          .find((c) => c !== null)
      : undefined;
    if (found === undefined) {
      throw new AppError(ErrorCode.StateTransitionInvalid, `Task ${task.key} did not fail on ${what}`, { taskId });
    }
    return { task, found };
  }

  /** The unfinished steps' checks `matches` picks become what `change` makes of them. */
  function rewrite(taskId: string, matches: (check: Check) => boolean, change: (check: Check) => Check) {
    for (const node of nodes.listByTask(taskId).filter((n) => UNFINISHED.includes(n.status))) {
      if (!node.acceptance.checks.some(matches)) continue;
      const checks = node.acceptance.checks.map((c) => (matches(c) ? change(c) : c));
      nodes.setAcceptance(node.id, { ...node.acceptance, checks });
    }
  }

  return {
    /** The new command replaces the failed one; steps that submitted a result are checked again with it. */
    async updateCheckCommand(taskId: string, command: string, updateProject: boolean): Promise<void> {
      const { task, found } = failedOn(taskId, nodes.failedCommand, 'a check command');
      if (updateProject) await projects.update({ id: task.projectId, checkCommand: command });
      unit.transact(() => {
        rewrite(
          taskId,
          (c) => c.kind === AcceptanceCheckKind.Command && c.command === found.command,
          () => ({ kind: AcceptanceCheckKind.Command, command }),
        );
        lifecycle.retry(taskId, { recheck: (node) => nodes.failedCommand(node) !== null });
      });
    },

    /**
     * Only a check that could not run: the steps go on without it, and the result card says so. A page check goes
     * from every unfinished step, since they share the task's preview.
     */
    skipCheck(taskId: string): void {
      const { found } = failedOn(taskId, nodes.unrunnableCheck, 'a check that could not run');
      unit.transact(() => {
        rewrite(
          taskId,
          (c) =>
            found.kind === AcceptanceCheckKind.Command
              ? c.kind === AcceptanceCheckKind.Command && c.command === found.command
              : c.kind === AcceptanceCheckKind.Browser,
          (c) => ({ ...c, skipped: true }),
        );
        lifecycle.retry(taskId);
      });
    },
  };
}
