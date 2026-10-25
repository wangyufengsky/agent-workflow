import { ATTEMPT_STATUSES, AttemptStatus } from '../enums/task.ts';
import { defineMachine } from './define.ts';

export const AttemptEvent = {
  SlotGranted: 'slot_granted',
  SessionStarted: 'session_started',
  StartFailed: 'start_failed',
  Submitted: 'submitted',
  SessionError: 'session_error',
  NoResult: 'no_result',
  Timeout: 'timeout',
  Abort: 'abort',
  RuntimeLost: 'runtime_lost',
} as const;
export type AttemptEvent = (typeof AttemptEvent)[keyof typeof AttemptEvent];

const S = AttemptStatus;
const E = AttemptEvent;

export const attemptMachine = defineMachine<AttemptStatus, AttemptEvent>({
  entity: 'attempt',
  states: ATTEMPT_STATUSES,
  events: Object.values(AttemptEvent),
  // Attempts that belong to no task queue for a model slot when all are taken (D186).
  initial: [S.Queued, S.Starting],
  table: {
    [S.Queued]: {
      [E.SlotGranted]: [S.Starting],
      [E.Abort]: [S.Aborted],
      [E.RuntimeLost]: [S.Interrupted],
    },
    // A task may be cancelled while the session is still being created.
    [S.Starting]: {
      [E.SessionStarted]: [S.Running],
      [E.StartFailed]: [S.Failed],
      [E.Abort]: [S.Aborted],
      [E.RuntimeLost]: [S.Interrupted],
    },
    [S.Running]: {
      [E.Submitted]: [S.Succeeded],
      [E.SessionError]: [S.Failed],
      [E.NoResult]: [S.Failed],
      [E.Timeout]: [S.Failed],
      [E.Abort]: [S.Aborted],
      [E.RuntimeLost]: [S.Interrupted],
    },
    [S.Succeeded]: {},
    [S.Failed]: {},
    [S.Aborted]: {},
    [S.Interrupted]: {},
  },
});
