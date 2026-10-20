import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError, DeliveryStrategy, ErrorCode, type LocalMergeStrategy } from '@aw/shared';
import {
  BACKEND_COMMITTER,
  branchExists,
  type GitResult,
  gitFailure,
  isAncestor,
  listWorktrees,
  type RepoLocks,
  readStatus,
  runGit,
  unmergedFiles,
} from '../git/index.ts';

export type LocalMergeInput = {
  repoPath: string;
  /** The task worktree, where its branch is checked out. */
  worktreePath: string;
  branch: string;
  targetBranch: string;
  strategy: LocalMergeStrategy;
  /** Subject of the squash or merge commit. */
  message: string;
};

export type MergeOutcome = { merged: true; commitSha: string } | { merged: false; conflictFiles: string[] };

/** Where the target branch is checked out (normally the user's main worktree), if anywhere. */
async function targetHolder(repoPath: string, targetBranch: string): Promise<string | undefined> {
  return (await listWorktrees(repoPath)).find((w) => w.branch === targetBranch)?.path;
}

/**
 * What must hold before a delivery starts (09 §7): the target exists, the task worktree has nothing uncommitted, and
 * a worktree with the target checked out — the user's own, usually — is clean, so the merge never touches the
 * user's uncommitted work.
 */
export async function checkDeliverable(input: {
  repoPath: string;
  worktreePath: string;
  targetBranch: string;
  checkTargetWorktree: boolean;
}): Promise<void> {
  if (!(await branchExists(input.repoPath, input.targetBranch))) {
    throw new AppError(ErrorCode.DeliveryTargetNotFound, 'Target branch does not exist', {
      branch: input.targetBranch,
    });
  }
  const own = await readStatus(input.worktreePath);
  if (!own.clean) {
    throw new AppError(ErrorCode.WorktreeDirty, 'The task worktree has uncommitted changes', {
      path: input.worktreePath,
      files: own.files.map((f) => f.path),
    });
  }
  if (!input.checkTargetWorktree) return;
  const holder = await targetHolder(input.repoPath, input.targetBranch);
  if (holder === undefined) return;
  const status = await readStatus(holder);
  if (!status.clean) {
    throw new AppError(ErrorCode.DeliveryTargetDirty, 'The target branch is checked out with uncommitted changes', {
      path: holder,
      branch: input.targetBranch,
      files: status.files.map((f) => f.path),
    });
  }
}

/** A command that stopped with exit 1: conflicts are aborted and reported, anything else is a failure. */
async function conflictOrFailure(
  cwd: string,
  args: readonly string[],
  result: GitResult,
  abort: readonly string[],
): Promise<MergeOutcome> {
  const conflictFiles = await unmergedFiles(cwd);
  if (conflictFiles.length === 0) throw gitFailure(args, result);
  await runGit(abort, { cwd });
  return { merged: false, conflictFiles };
}

const head = async (cwd: string) => (await runGit(['rev-parse', 'HEAD'], { cwd })).stdout.trim();

/** Runs the strategy in `dir`, where the target branch is checked out and clean. */
async function mergeIn(dir: string, input: LocalMergeInput): Promise<MergeOutcome> {
  const accept = { okExitCodes: [0, 1] };
  switch (input.strategy) {
    case DeliveryStrategy.Squash: {
      const args = [...BACKEND_COMMITTER, 'merge', '--squash', '--quiet', '--end-of-options', input.branch];
      const result = await runGit(args, { cwd: dir, ...accept });
      // A squash leaves no MERGE_HEAD, so `merge --abort` cannot undo it; `reset --merge` restores the index.
      if (result.exitCode === 1) return conflictOrFailure(dir, args, result, ['reset', '--merge']);
      const staged = await runGit(['diff', '--cached', '--quiet'], { cwd: dir, okExitCodes: [0, 1] });
      // Nothing to commit: the target already has every change (e.g. a delivery repeated after an interruption).
      if (staged.exitCode === 1) {
        await runGit([...BACKEND_COMMITTER, 'commit', '--quiet', '--no-verify', '-m', input.message], { cwd: dir });
      }
      return { merged: true, commitSha: await head(dir) };
    }
    case DeliveryStrategy.Merge: {
      const args = [
        ...BACKEND_COMMITTER,
        'merge',
        '--no-ff',
        '--no-verify',
        '--quiet',
        '-m',
        input.message,
        '--end-of-options',
        input.branch,
      ];
      const result = await runGit(args, { cwd: dir, ...accept });
      if (result.exitCode === 1) return conflictOrFailure(dir, args, result, ['merge', '--abort']);
      return { merged: true, commitSha: await head(dir) };
    }
    case DeliveryStrategy.Rebase: {
      // A branch that already contains the target (a resolved conflict merged it in) is fast-forwarded as it is:
      // rebasing it would replay the resolved conflict.
      if (!(await isAncestor(dir, input.targetBranch, input.branch))) {
        const args = [...BACKEND_COMMITTER, 'rebase', '--quiet', '--no-verify', '--end-of-options', input.targetBranch];
        const result = await runGit(args, { cwd: input.worktreePath, ...accept });
        if (result.exitCode === 1) return conflictOrFailure(input.worktreePath, args, result, ['rebase', '--abort']);
      }
      await runGit(['merge', '--ff-only', '--quiet', '--end-of-options', input.branch], { cwd: dir });
      return { merged: true, commitSha: await head(dir) };
    }
  }
}

/**
 * Merges the task branch into the target in the main repository (09 §7), under the repository lock. The merge runs
 * where the target is checked out; when it is checked out nowhere, in a temporary worktree removed afterwards.
 */
export function mergeLocally(locks: RepoLocks, input: LocalMergeInput): Promise<MergeOutcome> {
  return locks.run(input.repoPath, async () => {
    const holder = await targetHolder(input.repoPath, input.targetBranch);
    if (holder !== undefined) return mergeIn(holder, input);
    const parent = await mkdtemp(join(tmpdir(), 'aw-merge-'));
    const dir = join(parent, 'target');
    try {
      await runGit(['worktree', 'add', '--quiet', dir, input.targetBranch], { cwd: input.repoPath });
      try {
        return await mergeIn(dir, input);
      } finally {
        await runGit(['worktree', 'remove', '--force', dir], { cwd: input.repoPath });
      }
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
}
