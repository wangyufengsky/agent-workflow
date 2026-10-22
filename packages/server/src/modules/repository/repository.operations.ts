import {
  gitBranchesOp,
  gitChangeFileOp,
  gitChangesOp,
  gitCommitOp,
  gitCreateBranchOp,
  gitCreateCommitOp,
  gitCreatePullRequestOp,
  gitDeleteBranchOp,
  gitDiffFileOp,
  gitDiffOp,
  gitFetchOp,
  gitFileOp,
  gitLogOp,
  gitMergeOp,
  gitMergeWithAiOp,
  gitPullOp,
  gitPushOp,
  gitPushPreviewOp,
  gitStageOp,
  gitStatusOp,
  gitSwitchBranchOp,
  gitTreeOp,
  gitUnstageOp,
  listWorktreesOp,
  pruneWorktreesOp,
} from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { RepositoryService } from './repository.service.ts';
import type { RepositoryWrites } from './repository.write.ts';

export function repositoryOperations(repository: RepositoryService, writes: RepositoryWrites) {
  return [
    implement(gitStatusOp, ({ id }) => repository.status(id)),
    implement(gitBranchesOp, async ({ id }) => ({ items: await repository.branches(id) })),
    implement(gitLogOp, ({ id, ref, limit, cursor, author, search }) =>
      repository.log(id, ref, limit, cursor, { author, search }),
    ),
    implement(gitCommitOp, ({ id, sha, parent }) => repository.commit(id, sha, parent)),
    implement(gitDiffOp, ({ id, from, to }) => repository.diff(id, from, to)),
    implement(gitDiffFileOp, ({ id, from, to, path }) => repository.diffFile(id, from, to, path)),
    implement(gitTreeOp, async ({ id, ref, path }) => ({ items: await repository.tree(id, ref, path) })),
    implement(gitFileOp, ({ id, ref, path }) => repository.file(id, ref, path)),
    implement(gitFetchOp, ({ id }) => repository.fetch(id)),
    implement(gitChangesOp, ({ id }) => repository.changes(id)),
    implement(gitChangeFileOp, ({ id, path, side }) => repository.changeFile(id, path, side === 'staged')),
    implement(gitStageOp, ({ id, paths }) => writes.stage(id, paths)),
    implement(gitUnstageOp, ({ id, paths }) => writes.unstage(id, paths)),
    implement(gitCreateCommitOp, ({ id, message }) => writes.commit(id, message)),
    implement(gitPushPreviewOp, ({ id, branch }) => writes.pushPreview(id, branch)),
    implement(gitPushOp, ({ id, branch }) => writes.push(id, branch)),
    implement(gitPullOp, ({ id }) => writes.pull(id)),
    implement(gitCreateBranchOp, ({ id, name, startPoint, switch: andSwitch }) =>
      writes.createBranch(id, name, startPoint, andSwitch),
    ),
    implement(gitSwitchBranchOp, ({ id, branch }) => writes.switchBranch(id, branch)),
    implement(gitDeleteBranchOp, ({ id, name, force }) => writes.deleteBranch(id, name, force)),
    implement(gitMergeOp, ({ id, ...input }) => writes.merge(id, input)),
    implement(gitMergeWithAiOp, ({ id, source, target }) => writes.mergeWithAi(id, source, target)),
    implement(gitCreatePullRequestOp, ({ id, ...input }) => writes.createPullRequest(id, input)),
    implement(listWorktreesOp, async ({ id }) => ({ items: await repository.worktrees(id) })),
    implement(pruneWorktreesOp, async ({ id }) => ({ items: await repository.prune(id) })),
  ];
}
