import { DeliveryStatus } from '../enums/git.ts';
import { defineMachine } from './define.ts';

export const DeliveryEvent = {
  Succeeded: 'succeeded',
  Conflicted: 'conflicted',
  Failed: 'failed',
} as const;
export type DeliveryEvent = (typeof DeliveryEvent)[keyof typeof DeliveryEvent];

const S = DeliveryStatus;
const E = DeliveryEvent;

export const deliveryMachine = defineMachine<DeliveryStatus, DeliveryEvent>({
  entity: 'delivery',
  states: Object.values(DeliveryStatus),
  events: Object.values(DeliveryEvent),
  initial: [S.Running],
  table: {
    [S.Running]: { [E.Succeeded]: [S.Succeeded], [E.Conflicted]: [S.Conflict], [E.Failed]: [S.Failed] },
    [S.Succeeded]: {},
    [S.Conflict]: {},
    [S.Failed]: {},
  },
});
