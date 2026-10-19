import { RuntimeStatus } from '../enums/system.ts';
import { defineMachine } from './define.ts';

export const RuntimeEvent = {
  Start: 'start',
  Listening: 'listening',
  Exited: 'exited',
  Restart: 'restart',
  Recheck: 'recheck',
} as const;
export type RuntimeEvent = (typeof RuntimeEvent)[keyof typeof RuntimeEvent];

const S = RuntimeStatus;
const E = RuntimeEvent;
const DETECTED = [S.Stopped, S.NotInstalled, S.VersionMismatch];

export const runtimeMachine = defineMachine<RuntimeStatus, RuntimeEvent>({
  entity: 'runtime',
  states: Object.values(RuntimeStatus),
  events: Object.values(RuntimeEvent),
  // Environment detection at startup picks one of these.
  initial: DETECTED,
  table: {
    [S.NotInstalled]: { [E.Recheck]: DETECTED },
    [S.VersionMismatch]: { [E.Recheck]: DETECTED },
    [S.Stopped]: { [E.Start]: [S.Starting] },
    [S.Starting]: { [E.Listening]: [S.Ready], [E.Exited]: [S.Crashed] },
    [S.Ready]: { [E.Exited]: [S.Crashed], [E.Restart]: [S.Starting] },
    [S.Crashed]: { [E.Start]: [S.Starting] },
  },
});
