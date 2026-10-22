import { NODE_STATUSES, NodeStatus } from '../enums/task.ts';
import { defineMachine } from './define.ts';

export const NodeEvent = {
  DepsMet: 'deps_met',
  DepsUnmet: 'deps_unmet',
  Dispatch: 'dispatch',
  InputRequested: 'input_requested',
  InputAnswered: 'input_answered',
  ResultSubmitted: 'result_submitted',
  ChecksPassed: 'checks_passed',
  ChecksFailed: 'checks_failed',
  CheckUnrunnable: 'check_unrunnable',
  Recheck: 'recheck',
  AttemptFailed: 'attempt_failed',
  Interrupted: 'interrupted',
  Accept: 'accept',
  Reject: 'reject',
  Retry: 'retry',
  Skip: 'skip',
  Cancel: 'cancel',
} as const;
export type NodeEvent = (typeof NodeEvent)[keyof typeof NodeEvent];

const S = NodeStatus;
const E = NodeEvent;

export const nodeMachine = defineMachine<NodeStatus, NodeEvent>({
  entity: 'node',
  states: NODE_STATUSES,
  events: Object.values(NodeEvent),
  initial: [S.Pending, S.Ready],
  table: {
    [S.Pending]: { [E.DepsMet]: [S.Ready], [E.Skip]: [S.Skipped], [E.Cancel]: [S.Cancelled] },
    // A plan adjustment (paused task) may give a ready node a dependency that has not finished yet.
    [S.Ready]: {
      [E.Dispatch]: [S.Running],
      [E.DepsUnmet]: [S.Pending],
      [E.Skip]: [S.Skipped],
      [E.Cancel]: [S.Cancelled],
    },
    [S.Running]: {
      [E.InputRequested]: [S.WaitingInput],
      [E.ResultSubmitted]: [S.Verifying, S.AwaitingAcceptance, S.Done],
      [E.AttemptFailed]: [S.Ready, S.Failed],
      [E.Interrupted]: [S.Ready],
      [E.Cancel]: [S.Cancelled],
    },
    // The attempt keeps running while it waits; it can still fail (user abort) or be interrupted (runtime lost while a
    // permission request was pending: the request dies with the runtime).
    [S.WaitingInput]: {
      [E.InputAnswered]: [S.Running],
      [E.AttemptFailed]: [S.Ready, S.Failed],
      [E.Interrupted]: [S.Ready],
      [E.Cancel]: [S.Cancelled],
    },
    [S.Verifying]: {
      [E.ChecksPassed]: [S.AwaitingAcceptance, S.Done],
      [E.ChecksFailed]: [S.Ready, S.Failed],
      // A check command the app's environment cannot run is not the model's failure (D115).
      [E.CheckUnrunnable]: [S.Failed],
      [E.Interrupted]: [S.Ready],
      [E.Cancel]: [S.Cancelled],
    },
    [S.AwaitingAcceptance]: { [E.Accept]: [S.Done], [E.Reject]: [S.Ready], [E.Cancel]: [S.Cancelled] },
    [S.Done]: {},
    // `recheck`: the checks run again on the submitted result, without another attempt (D115).
    [S.Failed]: { [E.Retry]: [S.Ready], [E.Recheck]: [S.Verifying], [E.Skip]: [S.Skipped], [E.Cancel]: [S.Cancelled] },
    [S.Skipped]: {},
    [S.Cancelled]: {},
  },
});
