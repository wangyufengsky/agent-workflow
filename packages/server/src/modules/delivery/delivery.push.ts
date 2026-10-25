import { AppError, ErrorCode } from '@aw/shared';
import { branchExists, type GitNetwork, isAncestor, originEnv, type RepoLocks, runGit } from '../git/index.ts';

export type OriginBranchInput = { repoPath: string; branch: string; authorization: string; network: GitNetwork };

/** Pushes the task branch to `origin` for a pull request (09 §7), under the repository lock; never forced. */
export async function pushBranch(locks: RepoLocks, input: OriginBranchInput): Promise<void> {
  const ref = `refs/heads/${input.branch}`;
  await locks.run(input.repoPath, () =>
    runGit(['push', '--quiet', 'origin', `${ref}:${ref}`], {
      cwd: input.repoPath,
      env: originEnv(input.network, input.authorization),
    }),
  );
}

/**
 * Brings the local task branch up to the pull request's branch on `origin` before the AI revises it (21 §4.1):
 * reviewers may have committed suggestions there. Recreated when deleted locally, fast-forwarded when behind, kept
 * when ahead (an earlier push failed); BRANCH_DIVERGED, with nothing changed, when both have commits of their own.
 */
export async function syncBranchFromOrigin(locks: RepoLocks, input: OriginBranchInput): Promise<void> {
  const ref = `refs/heads/${input.branch}`;
  const cwd = input.repoPath;
  await locks.run(cwd, async () => {
    await runGit(['fetch', '--quiet', 'origin', ref], { cwd, env: originEnv(input.network, input.authorization) });
    const remote = (await runGit(['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], { cwd })).stdout.trim();
    if (!(await branchExists(cwd, input.branch))) {
      await runGit(['update-ref', ref, remote], { cwd });
      return;
    }
    const local = (await runGit(['rev-parse', '--verify', `${ref}^{commit}`], { cwd })).stdout.trim();
    if (await isAncestor(cwd, remote, local)) return;
    if (!(await isAncestor(cwd, local, remote))) {
      throw new AppError(ErrorCode.BranchDiverged, 'The task branch and its pull request branch have diverged', {
        branch: input.branch,
      });
    }
    await runGit(['update-ref', ref, remote, local], { cwd });
  });
}
