import { DeckStatus } from './deck.ts';
import { InitiativeItemStatus, InitiativeStatus } from './initiative.ts';
import { KnowledgeTurnStatus } from './knowledge.ts';
import { ScheduleStatus } from './schedule.ts';
import { RuntimeStatus } from './system.ts';
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
  knowledgeTurn: {
    [KnowledgeTurnStatus.Researching]: StatusTone.Run,
    [KnowledgeTurnStatus.Answered]: StatusTone.Ok,
    [KnowledgeTurnStatus.Stopped]: StatusTone.Idle,
    [KnowledgeTurnStatus.Failed]: StatusTone.Danger,
  },
  deck: {
    [DeckStatus.Outlining]: StatusTone.Run,
    [DeckStatus.OutlineReady]: StatusTone.Wait,
    [DeckStatus.Failed]: StatusTone.Danger,
    [DeckStatus.Generating]: StatusTone.Run,
    [DeckStatus.Incomplete]: StatusTone.Warn,
    [DeckStatus.Ready]: StatusTone.Ok,
  },
  runtime: {
    [RuntimeStatus.NotInstalled]: StatusTone.Danger,
    [RuntimeStatus.VersionMismatch]: StatusTone.Danger,
    [RuntimeStatus.Stopped]: StatusTone.Wait,
    [RuntimeStatus.Starting]: StatusTone.Run,
    [RuntimeStatus.Ready]: StatusTone.Ok,
    [RuntimeStatus.Crashed]: StatusTone.Danger,
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
  schedule: {
    [ScheduleStatus.Active]: StatusTone.Ok,
    [ScheduleStatus.Paused]: StatusTone.Wait,
  },
  initiative: {
    [InitiativeStatus.DraftReady]: StatusTone.Wait,
    [InitiativeStatus.InProgress]: StatusTone.Run,
    [InitiativeStatus.PhaseDone]: StatusTone.Wait,
    [InitiativeStatus.Done]: StatusTone.Done,
  },
  initiativeItem: {
    [InitiativeItemStatus.Dropped]: StatusTone.Idle,
    [InitiativeItemStatus.Satisfied]: StatusTone.Done,
    [InitiativeItemStatus.PrOpen]: StatusTone.Wait,
    [InitiativeItemStatus.InTask]: StatusTone.Run,
    [InitiativeItemStatus.PhaseClosed]: StatusTone.Idle,
    [InitiativeItemStatus.Waiting]: StatusTone.Idle,
    [InitiativeItemStatus.Ready]: StatusTone.Wait,
  },
} as const satisfies {
  task: Record<TaskStatus, StatusTone>;
  node: Record<NodeStatus, StatusTone>;
  attempt: Record<AttemptStatus, StatusTone>;
  knowledgeTurn: Record<KnowledgeTurnStatus, StatusTone>;
  deck: Record<DeckStatus, StatusTone>;
  runtime: Record<RuntimeStatus, StatusTone>;
  taskDisplay: Record<TaskDisplayGroup, StatusTone>;
  schedule: Record<ScheduleStatus, StatusTone>;
  initiative: Record<InitiativeStatus, StatusTone>;
  initiativeItem: Record<InitiativeItemStatus, StatusTone>;
};
