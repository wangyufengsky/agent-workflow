import { TeamAnalysisStatus } from '../enums/team.ts';
import { defineMachine } from './define.ts';

export const TeamAnalysisEvent = {
  /** Its turn came: the session started. */
  Start: 'start',
  /** The analysis was submitted. */
  Submit: 'submit',
  /** The session ended without one, could not start, or the app restarted. */
  Fail: 'fail',
  Cancel: 'cancel',
} as const;
export type TeamAnalysisEvent = (typeof TeamAnalysisEvent)[keyof typeof TeamAnalysisEvent];

const S = TeamAnalysisStatus;
const E = TeamAnalysisEvent;

/** 33 §6.4: one project analyses one member at a time; the others are queued. */
export const teamAnalysisMachine = defineMachine<TeamAnalysisStatus, TeamAnalysisEvent>({
  entity: 'team_analysis',
  states: Object.values(TeamAnalysisStatus),
  events: Object.values(TeamAnalysisEvent),
  initial: [S.Queued],
  table: {
    [S.Queued]: { [E.Start]: [S.Running], [E.Fail]: [S.Failed], [E.Cancel]: [S.Cancelled] },
    [S.Running]: { [E.Submit]: [S.Succeeded], [E.Fail]: [S.Failed], [E.Cancel]: [S.Cancelled] },
    [S.Succeeded]: {},
    [S.Failed]: {},
    [S.Cancelled]: {},
  },
});
