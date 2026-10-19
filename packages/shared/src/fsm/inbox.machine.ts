import { InboxStatus } from '../enums/inbox.ts';
import { defineMachine } from './define.ts';

export const InboxEvent = {
  Resolve: 'resolve',
  Dismiss: 'dismiss',
} as const;
export type InboxEvent = (typeof InboxEvent)[keyof typeof InboxEvent];

const S = InboxStatus;
const E = InboxEvent;

export const inboxMachine = defineMachine<InboxStatus, InboxEvent>({
  entity: 'inbox_item',
  states: Object.values(InboxStatus),
  events: Object.values(InboxEvent),
  // Questions answered by the model's own assumption are recorded directly as resolved (10 §inbox_items).
  initial: [S.Open, S.Resolved],
  table: {
    [S.Open]: { [E.Resolve]: [S.Resolved], [E.Dismiss]: [S.Dismissed] },
    [S.Resolved]: {},
    [S.Dismissed]: {},
  },
});
