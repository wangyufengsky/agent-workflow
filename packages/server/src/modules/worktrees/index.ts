import { createWorktreesService, type WorktreesServiceDeps } from './worktrees.service.ts';

export type { Worktree } from './worktrees.repo.ts';
export { branchName, type CreateWorktreeInput, type WorktreesService } from './worktrees.service.ts';

export function createWorktreesModule(deps: WorktreesServiceDeps) {
  return { service: createWorktreesService(deps) };
}
