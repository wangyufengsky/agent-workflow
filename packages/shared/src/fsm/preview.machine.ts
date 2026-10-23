import { PreviewState } from '../enums/browser.ts';
import { defineMachine } from './define.ts';

export const PreviewEvent = {
  Start: 'start',
  /** The ready path answered with any HTTP response. */
  Ready: 'ready',
  /** The process exited, or did not become ready in time (the backend then ends it). */
  Exited: 'exited',
  /** The user, idleness, the task ending or its worktree going away. */
  Stop: 'stop',
} as const;
export type PreviewEvent = (typeof PreviewEvent)[keyof typeof PreviewEvent];

const S = PreviewState;
const E = PreviewEvent;

export const previewMachine = defineMachine<PreviewState, PreviewEvent>({
  entity: 'preview',
  states: Object.values(PreviewState),
  events: Object.values(PreviewEvent),
  initial: [S.Stopped],
  table: {
    [S.Stopped]: { [E.Start]: [S.Starting] },
    [S.Starting]: { [E.Ready]: [S.Running], [E.Exited]: [S.Failed], [E.Stop]: [S.Stopped] },
    [S.Running]: { [E.Exited]: [S.Failed], [E.Stop]: [S.Stopped] },
    [S.Failed]: { [E.Start]: [S.Starting] },
  },
});
