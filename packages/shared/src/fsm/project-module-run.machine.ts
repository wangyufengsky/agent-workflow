import { defineMachine } from './define.ts';

export const ProjectModuleRunStatus = {
  Starting: 'starting',
  Ready: 'ready',
  Running: 'running',
  Passed: 'passed',
  Failed: 'failed',
  Stopped: 'stopped',
  Interrupted: 'interrupted',
} as const;
export type ProjectModuleRunStatus = (typeof ProjectModuleRunStatus)[keyof typeof ProjectModuleRunStatus];

export const ProjectModuleRunEvent = {
  Ready: 'ready',
  Pass: 'pass',
  Fail: 'fail',
  Stop: 'stop',
  Interrupt: 'interrupt',
} as const;
export type ProjectModuleRunEvent = (typeof ProjectModuleRunEvent)[keyof typeof ProjectModuleRunEvent];

const S = ProjectModuleRunStatus;
const E = ProjectModuleRunEvent;

export const projectModuleRunInitialStatus = {
  launch: S.Starting,
  checks: S.Running,
} as const;

const active = { [E.Fail]: [S.Failed], [E.Stop]: [S.Stopped], [E.Interrupt]: [S.Interrupted] };

export const projectModuleRunMachine = defineMachine<ProjectModuleRunStatus, ProjectModuleRunEvent>({
  entity: 'project_module_run',
  states: Object.values(S),
  events: Object.values(E),
  initial: Object.values(projectModuleRunInitialStatus),
  table: {
    [S.Starting]: { ...active, [E.Ready]: [S.Ready] },
    [S.Ready]: active,
    [S.Running]: { ...active, [E.Pass]: [S.Passed] },
    [S.Passed]: {},
    [S.Failed]: {},
    [S.Stopped]: {},
    [S.Interrupted]: {},
  },
});
