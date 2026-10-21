import { WorktreeStatus } from '../enums/git.ts';
import { defineMachine } from './define.ts';

export const WorktreeEvent = {
  Created: 'created',
  CreateFailed: 'create_failed',
  Remove: 'remove',
  Removed: 'removed',
  RemoveFailed: 'remove_failed',
  /** The worktree of a task delivered as a pull request comes back on its kept branch (21 §4.2). */
  Restore: 'restore',
} as const;
export type WorktreeEvent = (typeof WorktreeEvent)[keyof typeof WorktreeEvent];

const S = WorktreeStatus;
const E = WorktreeEvent;

export const worktreeMachine = defineMachine<WorktreeStatus, WorktreeEvent>({
  entity: 'worktree',
  states: Object.values(WorktreeStatus),
  events: Object.values(WorktreeEvent),
  initial: [S.Creating],
  table: {
    [S.Creating]: { [E.Created]: [S.Ready], [E.CreateFailed]: [S.Error] },
    [S.Ready]: { [E.Remove]: [S.Removing] },
    [S.Removing]: { [E.Removed]: [S.Removed], [E.RemoveFailed]: [S.Error] },
    [S.Removed]: { [E.Restore]: [S.Creating] },
    [S.Error]: { [E.Remove]: [S.Removing] },
  },
  reopenedBy: [E.Restore],
});
