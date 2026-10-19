import { isTerminalState } from '../fsm/define.ts';
import { taskMachine } from '../fsm/task.machine.ts';
import { TaskDisplayGroup, TaskStatus } from './task.ts';

/** Display group of each task status when no attention item is open (08 §2.2). */
export const TASK_DISPLAY_GROUP = {
  [TaskStatus.Draft]: TaskDisplayGroup.Preparing,
  [TaskStatus.Preparing]: TaskDisplayGroup.Preparing,
  [TaskStatus.Planning]: TaskDisplayGroup.Preparing,
  [TaskStatus.PlanReview]: TaskDisplayGroup.PlanReview,
  [TaskStatus.Running]: TaskDisplayGroup.Running,
  [TaskStatus.Paused]: TaskDisplayGroup.Paused,
  [TaskStatus.Review]: TaskDisplayGroup.Review,
  [TaskStatus.Merging]: TaskDisplayGroup.Merging,
  [TaskStatus.Completed]: TaskDisplayGroup.Completed,
  [TaskStatus.Failed]: TaskDisplayGroup.Failed,
  [TaskStatus.Cancelled]: TaskDisplayGroup.Cancelled,
} as const satisfies Record<TaskStatus, TaskDisplayGroup>;

/** An open question / permission / acceptance item overrides the status of any non-terminal task. */
export function resolveTaskDisplayGroup(status: TaskStatus, hasOpenAttentionItem: boolean): TaskDisplayGroup {
  if (hasOpenAttentionItem && !isTerminalState(taskMachine, status)) return TaskDisplayGroup.NeedsAttention;
  return TASK_DISPLAY_GROUP[status];
}
