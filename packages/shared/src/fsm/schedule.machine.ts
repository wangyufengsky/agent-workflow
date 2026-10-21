import { ScheduleStatus } from '../enums/schedule.ts';
import { defineMachine } from './define.ts';

export const ScheduleEvent = {
  Pause: 'pause',
  Resume: 'resume',
  /** A run could not start its task (22 §5). */
  StartFailed: 'start_failed',
} as const;
export type ScheduleEvent = (typeof ScheduleEvent)[keyof typeof ScheduleEvent];

const S = ScheduleStatus;
const E = ScheduleEvent;

/** No terminal state: deleting a schedule deletes its row (22 §3). */
export const scheduleMachine = defineMachine<ScheduleStatus, ScheduleEvent>({
  entity: 'schedule',
  states: Object.values(ScheduleStatus),
  events: Object.values(ScheduleEvent),
  initial: [S.Active],
  table: {
    [S.Active]: { [E.Pause]: [S.Paused], [E.StartFailed]: [S.Paused] },
    [S.Paused]: { [E.Resume]: [S.Active] },
  },
});
