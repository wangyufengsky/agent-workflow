import {
  gitBranchesOp,
  gitCommitOp,
  gitDiffFileOp,
  gitDiffOp,
  gitFetchOp,
  gitFileOp,
  gitLogOp,
  gitStatusOp,
  gitTreeOp,
  listWorktreesOp,
  pruneWorktreesOp,
} from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { RepositoryService } from './repository.service.ts';

export function repositoryOperations(repository: RepositoryService) {
  return [
    implement(gitStatusOp, ({ id }) => repository.status(id)),
    implement(gitBranchesOp, async ({ id }) => ({ items: await repository.branches(id) })),
    implement(gitLogOp, ({ id, ref, limit, cursor }) => repository.log(id, ref, limit, cursor)),
    implement(gitCommitOp, ({ id, sha }) => repository.commit(id, sha)),
    implement(gitDiffOp, ({ id, from, to }) => repository.diff(id, from, to)),
    implement(gitDiffFileOp, ({ id, from, to, path }) => repository.diffFile(id, from, to, path)),
    implement(gitTreeOp, async ({ id, ref, path }) => ({ items: await repository.tree(id, ref, path) })),
    implement(gitFileOp, ({ id, ref, path }) => repository.file(id, ref, path)),
    implement(gitFetchOp, ({ id }) => repository.fetch(id)),
    implement(listWorktreesOp, async ({ id }) => ({ items: await repository.worktrees(id) })),
    implement(pruneWorktreesOp, async ({ id }) => ({ items: await repository.prune(id) })),
  ];
}
