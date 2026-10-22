import { AppError, ErrorCode } from '@aw/shared';
import { runGit } from './git.cli.ts';

// The user's own Git operations in the main worktree (27 §3, D108). Callers hold the repository lock and have
// checked the workbench's preconditions; these run git as the user: their identity, their hooks, their signing.

/** Whether HEAD points at a commit (false before the first commit). */
async function hasHead(cwd: string): Promise<boolean> {
  const { exitCode } = await runGit(['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd, okExitCodes: [0, 1] });
  return exitCode === 0;
}

/** Stages whole files, deletions included. */
export async function stage(cwd: string, paths: readonly string[]): Promise<void> {
  await runGit(['add', '--all', '--', ...paths], { cwd });
}

/** Unstages whole files and keeps their changes; before the first commit there is no HEAD to restore from. */
export async function unstage(cwd: string, paths: readonly string[]): Promise<void> {
  const args = (await hasHead(cwd))
    ? ['restore', '--staged', '--', ...paths]
    : ['rm', '--cached', '-r', '--quiet', '--', ...paths];
  await runGit(args, { cwd });
}

/** Whether the index differs from HEAD. */
export async function hasStagedChanges(cwd: string): Promise<boolean> {
  const { exitCode } = await runGit(['diff', '--cached', '--quiet'], { cwd, okExitCodes: [0, 1] });
  return exitCode === 1;
}

/**
 * Commits the index; the user's hooks run and a rejection fails with their output in `stderr`. Returns the new
 * commit's id.
 */
export async function commit(cwd: string, message: string): Promise<string> {
  await runGit(['commit', '--quiet', '--cleanup=strip', '-m', message], { cwd });
  return (await runGit(['rev-parse', 'HEAD'], { cwd })).stdout.trim();
}

/** Whether `name` is a valid branch name for git. */
export async function isValidBranchName(cwd: string, name: string): Promise<boolean> {
  const { exitCode } = await runGit(['check-ref-format', '--branch', name], { cwd, okExitCodes: [0, 128] });
  return exitCode === 0;
}

export async function createBranch(cwd: string, name: string, startPoint: string): Promise<void> {
  await runGit(['branch', '--quiet', '--end-of-options', name, startPoint], { cwd });
}

/** Checks out a local branch, or a remote-tracking one (`origin/x`) as a new local branch tracking it. */
export async function switchBranch(cwd: string, branch: string, remote: boolean): Promise<void> {
  await runGit(remote ? ['switch', '--quiet', '--track', branch] : ['switch', '--quiet', branch], { cwd });
}

/**
 * Deletes a local branch. Without `force` it must be merged where `git branch -d` looks — its upstream, or HEAD when
 * it has none — or GIT_BRANCH_NOT_MERGED.
 */
export async function deleteBranch(cwd: string, name: string, force: boolean): Promise<void> {
  if (!force) {
    const upstream = await runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${name}@{upstream}`], {
      cwd,
      okExitCodes: [0, 1, 128],
    });
    const into = upstream.exitCode === 0 ? upstream.stdout.trim() : 'HEAD';
    const merged = await runGit(['merge-base', '--is-ancestor', `refs/heads/${name}`, into], {
      cwd,
      okExitCodes: [0, 1],
    });
    if (merged.exitCode !== 0) {
      throw new AppError(ErrorCode.GitBranchNotMerged, `Branch ${name} is not fully merged`, { branch: name });
    }
  }
  await runGit(['branch', '-D', '--', name], { cwd });
}

/** The upstream of the checked-out branch (`origin/main`) and its remote, or undefined when it has none. */
export async function readUpstream(cwd: string): Promise<{ remote: string; ref: string } | undefined> {
  const branch = await runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd, okExitCodes: [0, 1] });
  if (branch.exitCode !== 0) return undefined;
  const [ref, remote] = await Promise.all([
    runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { cwd, okExitCodes: [0, 128] }),
    runGit(['config', '--get', `branch.${branch.stdout.trim()}.remote`], { cwd, okExitCodes: [0, 1] }),
  ]);
  if (ref.exitCode !== 0 || remote.exitCode !== 0) return undefined;
  return { remote: remote.stdout.trim(), ref: ref.stdout.trim() };
}

/** Fast-forwards the checked-out branch to `upstream`; BRANCH_DIVERGED when that is not possible. */
export async function fastForward(cwd: string, upstream: string): Promise<void> {
  const head = (await runGit(['rev-parse', 'HEAD'], { cwd })).stdout.trim();
  const { exitCode } = await runGit(['merge-base', '--is-ancestor', head, upstream], { cwd, okExitCodes: [0, 1] });
  if (exitCode !== 0) {
    throw new AppError(ErrorCode.BranchDiverged, 'The branch has commits its upstream lacks', { upstream });
  }
  await runGit(['merge', '--ff-only', '--quiet', '--end-of-options', upstream], { cwd });
}
