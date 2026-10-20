export { type GitOptions, type GitResult, runGit } from './git.cli.ts';
export { diffCommits, diffWorktree, diffWorktreeFile } from './git.diff.ts';
export { createRepoLocks, type RepoLocks } from './git.lock.ts';
export {
  branchExists,
  readDefaultBranch,
  readGitVersion,
  readHead,
  readOriginUrl,
  readRepoRoot,
} from './git.queries.ts';
