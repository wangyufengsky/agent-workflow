export { BACKEND_COMMITTER, type GitOptions, type GitResult, gitFailure, runGit } from './git.cli.ts';
export {
  diffChangeFile,
  diffCommits,
  diffCommitsFile,
  diffStaged,
  diffUnstaged,
  diffWorktree,
  diffWorktreeFile,
  limitDiff,
  parseNumstat,
} from './git.diff.ts';
export { createRepoLocks, type RepoLocks } from './git.lock.ts';
export { beforeArgs, type LogFilter, readCommit, readLog, readRevisions } from './git.log.ts';
export {
  branchExists,
  readDefaultBranch,
  readGitVersion,
  readHead,
  readOriginUrl,
  readRepoRoot,
} from './git.queries.ts';
export { distance, fetchAll, type GitRef, isAncestor, listBranches, mergeBase } from './git.refs.ts';
export { fetchRemote, isPushRejected, originEnv, pushToOrigin } from './git.remote.ts';
export { locateOpencodeShell, locateShell } from './git.shell.ts';
export {
  hasMergeHead,
  readConfiguredIdentity,
  readFetchedAt,
  readIdentity,
  readOperation,
  readStatus,
  unmergedFiles,
  type WorkTreeStatus,
} from './git.status.ts';
export { readFile, readTree } from './git.tree.ts';
export { type GitWorktree, listWorktrees } from './git.worktrees.ts';
export {
  commit,
  createBranch,
  deleteBranch,
  fastForward,
  hasStagedChanges,
  isValidBranchName,
  readUpstream,
  stage,
  switchBranch,
  unstage,
} from './git.write.ts';
