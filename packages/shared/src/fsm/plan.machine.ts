import { PlanStatus } from '../enums/task.ts';
import { defineMachine } from './define.ts';

export const PlanEvent = {
  Confirm: 'confirm',
  Supersede: 'supersede',
} as const;
export type PlanEvent = (typeof PlanEvent)[keyof typeof PlanEvent];

const S = PlanStatus;
const E = PlanEvent;

export const planMachine = defineMachine<PlanStatus, PlanEvent>({
  entity: 'plan',
  states: Object.values(PlanStatus),
  events: Object.values(PlanEvent),
  initial: [S.Draft],
  table: {
    [S.Draft]: { [E.Confirm]: [S.Confirmed], [E.Supersede]: [S.Superseded] },
    [S.Confirmed]: { [E.Supersede]: [S.Superseded] },
    [S.Superseded]: {},
  },
});
