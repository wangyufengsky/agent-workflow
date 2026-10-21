import { TASK_STATUSES, TaskStatus } from '../enums/task.ts';
import { defineMachine } from './define.ts';

export const TaskEvent = {
  Start: 'start',
  WorkspaceReady: 'workspace_ready',
  PlanSubmitted: 'plan_submitted',
  PlanConfirmed: 'plan_confirmed',
  ReplanRequested: 'replan_requested',
  Pause: 'pause',
  Resume: 'resume',
  AllNodesFinished: 'all_nodes_finished',
  ChangesRequested: 'changes_requested',
  Deliver: 'deliver',
  DeliverySucceeded: 'delivery_succeeded',
  DeliveryConflict: 'delivery_conflict',
  DeliveryFailed: 'delivery_failed',
  ReviewFeedback: 'review_feedback',
  Fail: 'fail',
  Retry: 'retry',
  Cancel: 'cancel',
} as const;
export type TaskEvent = (typeof TaskEvent)[keyof typeof TaskEvent];

const S = TaskStatus;
const E = TaskEvent;

export const taskMachine = defineMachine<TaskStatus, TaskEvent>({
  entity: 'task',
  states: TASK_STATUSES,
  events: Object.values(TaskEvent),
  initial: [S.Draft],
  table: {
    [S.Draft]: { [E.Start]: [S.Preparing], [E.Cancel]: [S.Cancelled] },
    [S.Preparing]: {
      [E.WorkspaceReady]: [S.Planning, S.PlanReview, S.Running],
      [E.Fail]: [S.Failed],
      [E.Cancel]: [S.Cancelled],
    },
    [S.Planning]: { [E.PlanSubmitted]: [S.PlanReview, S.Running], [E.Fail]: [S.Failed], [E.Cancel]: [S.Cancelled] },
    [S.PlanReview]: { [E.PlanConfirmed]: [S.Running], [E.ReplanRequested]: [S.Planning], [E.Cancel]: [S.Cancelled] },
    [S.Running]: {
      [E.Pause]: [S.Paused],
      [E.AllNodesFinished]: [S.Review],
      [E.Fail]: [S.Failed],
      [E.Cancel]: [S.Cancelled],
    },
    [S.Paused]: { [E.Resume]: [S.Running], [E.Cancel]: [S.Cancelled] },
    [S.Review]: {
      [E.ChangesRequested]: [S.Running],
      [E.Deliver]: [S.Merging, S.Completed],
      [E.Cancel]: [S.Cancelled],
    },
    [S.Merging]: {
      [E.DeliverySucceeded]: [S.Completed],
      [E.DeliveryConflict]: [S.Review],
      [E.DeliveryFailed]: [S.Review],
    },
    // Only a task delivered as a pull request that is still open (21 §7); the service decides.
    [S.Completed]: { [E.ReviewFeedback]: [S.Running] },
    [S.Failed]: { [E.Retry]: [S.Preparing, S.Planning, S.Running], [E.Cancel]: [S.Cancelled] },
    [S.Cancelled]: {},
  },
  reopenedBy: [E.ReviewFeedback],
});
