import { NODE_STATUSES, NodeStatus } from '../enums/task.ts';
import { defineMachine } from './define.ts';

export const NodeEvent = {
  DepsMet: 'deps_met',
  Dispatch: 'dispatch',
  InputRequested: 'input_requested',
  InputAnswered: 'input_answered',
  ResultSubmitted: 'result_submitted',
  ChecksPassed: 'checks_passed',
  ChecksFailed: 'checks_failed',
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
    [S.Ready]: { [E.Dispatch]: [S.Running], [E.Skip]: [S.Skipped], [E.Cancel]: [S.Cancelled] },
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
      [E.Interrupted]: [S.Ready],
      [E.Cancel]: [S.Cancelled],
    },
    [S.AwaitingAcceptance]: { [E.Accept]: [S.Done], [E.Reject]: [S.Ready], [E.Cancel]: [S.Cancelled] },
    [S.Done]: {},
    [S.Failed]: { [E.Retry]: [S.Ready], [E.Skip]: [S.Skipped], [E.Cancel]: [S.Cancelled] },
    [S.Skipped]: {},
    [S.Cancelled]: {},
  },
});
