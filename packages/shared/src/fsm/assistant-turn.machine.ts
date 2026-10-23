import { AssistantTurnEvent as E, AssistantTurnStatus as S } from '../enums/assistant.ts';
import { defineMachine } from './define.ts';

export const assistantTurnMachine = defineMachine<S, E>({
  entity: 'assistant_turn',
  states: Object.values(S),
  events: Object.values(E),
  initial: [S.Running],
  table: {
    [S.Running]: {
      [E.Idle]: [S.Completed],
      [E.Abort]: [S.Aborted],
      [E.Error]: [S.Failed],
      [E.RuntimeLost]: [S.Interrupted],
      [E.BackendRestart]: [S.Interrupted],
      [E.Timeout]: [S.TimedOut],
    },
    [S.Completed]: {},
    [S.Aborted]: {},
    [S.Failed]: {},
    [S.Interrupted]: {},
    [S.TimedOut]: {},
  },
});
