import { AssistantConfirmationStatus } from '../enums/assistant.ts';
import { defineMachine } from './define.ts';

export const AssistantConfirmationEvent = {
  Confirm: 'confirm',
  Cancel: 'cancel',
} as const;
export type AssistantConfirmationEvent = (typeof AssistantConfirmationEvent)[keyof typeof AssistantConfirmationEvent];

const S = AssistantConfirmationStatus;
const E = AssistantConfirmationEvent;

export const assistantConfirmationMachine = defineMachine<AssistantConfirmationStatus, AssistantConfirmationEvent>({
  entity: 'assistant_confirmation',
  states: Object.values(AssistantConfirmationStatus),
  events: Object.values(AssistantConfirmationEvent),
  initial: [S.Pending],
  table: {
    [S.Pending]: { [E.Confirm]: [S.Confirmed], [E.Cancel]: [S.Cancelled] },
    [S.Confirmed]: {},
    [S.Cancelled]: {},
  },
});
