import { AttemptStatus, NodeStatus, TaskDisplayGroup, TaskStatus } from './task.ts';
import { StatusTone } from './ui.ts';

/** Status → colour tone (08 §3). */
export const STATUS_TONE = {
  task: {
    [TaskStatus.Draft]: StatusTone.Idle,
    [TaskStatus.Preparing]: StatusTone.Run,
    [TaskStatus.Planning]: StatusTone.Run,
    [TaskStatus.PlanReview]: StatusTone.Wait,
    [TaskStatus.Running]: StatusTone.Run,
    [TaskStatus.Paused]: StatusTone.Wait,
    [TaskStatus.Review]: StatusTone.Ok,
    [TaskStatus.Merging]: StatusTone.Run,
    [TaskStatus.Completed]: StatusTone.Done,
    [TaskStatus.Failed]: StatusTone.Danger,
    [TaskStatus.Cancelled]: StatusTone.Warn,
  },
  node: {
    [NodeStatus.Pending]: StatusTone.Idle,
    [NodeStatus.Ready]: StatusTone.Run,
    [NodeStatus.Running]: StatusTone.Run,
    [NodeStatus.WaitingInput]: StatusTone.Wait,
    [NodeStatus.Verifying]: StatusTone.Run,
    [NodeStatus.AwaitingAcceptance]: StatusTone.Wait,
    [NodeStatus.Done]: StatusTone.Ok,
    [NodeStatus.Failed]: StatusTone.Danger,
    [NodeStatus.Skipped]: StatusTone.Idle,
    [NodeStatus.Cancelled]: StatusTone.Idle,
  },
  attempt: {
    [AttemptStatus.Starting]: StatusTone.Run,
    [AttemptStatus.Running]: StatusTone.Run,
    [AttemptStatus.Succeeded]: StatusTone.Ok,
    [AttemptStatus.Failed]: StatusTone.Danger,
    [AttemptStatus.Aborted]: StatusTone.Warn,
    [AttemptStatus.Interrupted]: StatusTone.Warn,
  },
  taskDisplay: {
    [TaskDisplayGroup.Preparing]: StatusTone.Run,
    [TaskDisplayGroup.PlanReview]: StatusTone.Wait,
    [TaskDisplayGroup.Running]: StatusTone.Run,
    [TaskDisplayGroup.Paused]: StatusTone.Wait,
    [TaskDisplayGroup.NeedsAttention]: StatusTone.Wait,
    [TaskDisplayGroup.Review]: StatusTone.Ok,
    [TaskDisplayGroup.Merging]: StatusTone.Run,
    [TaskDisplayGroup.Completed]: StatusTone.Done,
    [TaskDisplayGroup.Failed]: StatusTone.Danger,
    [TaskDisplayGroup.Cancelled]: StatusTone.Warn,
  },
} as const satisfies {
  task: Record<TaskStatus, StatusTone>;
  node: Record<NodeStatus, StatusTone>;
  attempt: Record<AttemptStatus, StatusTone>;
  taskDisplay: Record<TaskDisplayGroup, StatusTone>;
};
