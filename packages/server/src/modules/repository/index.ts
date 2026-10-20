import { repositoryOperations } from './repository.operations.ts';
import { createRepositoryService, type RepositoryServiceDeps } from './repository.service.ts';

export type { RepositoryService } from './repository.service.ts';

/** The Git console (pro mode): repository browsing, branches, commits and diffs, and the worktree overview. */
export function createRepositoryModule(deps: RepositoryServiceDeps) {
  const service = createRepositoryService(deps);
  return { service, operations: repositoryOperations(service) };
}
