import { repositoryOperations } from './repository.operations.ts';
import { createRepositoryService, type RepositoryServiceDeps } from './repository.service.ts';
import { createRepositoryWrites } from './repository.write.ts';

export type { RepositoryService } from './repository.service.ts';
export type { RepositoryWrites } from './repository.write.ts';

/** The Git workbench (pro mode, 27): repository browsing, the user's own Git operations, the worktree overview. */
export function createRepositoryModule(deps: RepositoryServiceDeps) {
  const service = createRepositoryService(deps);
  const writes = createRepositoryWrites(deps);
  return { service, writes, operations: repositoryOperations(service, writes) };
}
