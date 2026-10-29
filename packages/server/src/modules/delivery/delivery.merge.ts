import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppError,
  type CommitIdentity,
  DeliveryStrategy,
  ErrorCode,
  GitMergeStrategy,
  type LocalMergeStrategy,
} from '@aw/shared';
import {
  backendCommitter,
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
  /** Setting `git.commitIdentity` (D227). */
  identity: CommitIdentity | null;
};

export type MergeOutcome = { merged: true; commitSha: string } | { merged: false; conflictFiles: string[] };

/**
 * Who a merge commits as: the backend for a task's delivery (D52: its identity, no hooks or signing), the user in the
 * Git workbench (27 §2: their identity, hooks and signing).
 */
type Committer = { identity: readonly string[]; hooks: boolean };
const backend = (identity: CommitIdentity | null): Committer => ({
  identity: backendCommitter(identity),
  hooks: false,
});
const USER: Committer = { identity: [], hooks: true };

/** Where the target branch is checked out (normally the user's main worktree), if anywhere. */
export async function targetHolder(repoPath: string, targetBranch: string): Promise<string | undefined> {
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
  if (holder !== undefined) await assertTargetClean(holder, input.targetBranch);
}

/** The worktree with the target checked out has nothing uncommitted, staged or not. */
async function assertTargetClean(holder: string, targetBranch: string): Promise<void> {
  const status = await readStatus(holder);
  if (!status.clean) {
    throw new AppError(ErrorCode.DeliveryTargetDirty, 'The target branch is checked out with uncommitted changes', {
      path: holder,
      branch: targetBranch,
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
  // A user's hook can stop a merge with nothing conflicting (27 §2); undo it as well, then report the failure. The
  // abort finds nothing to undo when git stopped before starting (exit 128).
  await runGit(abort, { cwd, okExitCodes: conflictFiles.length === 0 ? [0, 128] : [0] });
  if (conflictFiles.length === 0) throw gitFailure(args, result);
  return { merged: false, conflictFiles };
}

const head = async (cwd: string) => (await runGit(['rev-parse', 'HEAD'], { cwd })).stdout.trim();

/** Merges `source` into the branch checked out (and clean) in `dir`, as merge commit or squash. */
async function mergeOrSquash(
  dir: string,
  source: string,
  squash: boolean,
  message: string,
  { identity, hooks }: Committer,
): Promise<MergeOutcome> {
  const accept = { okExitCodes: [0, 1] };
  const noVerify = hooks ? [] : ['--no-verify'];
  if (squash) {
    const args = [...identity, 'merge', '--squash', '--quiet', '--end-of-options', source];
    const result = await runGit(args, { cwd: dir, ...accept });
    // A squash leaves no MERGE_HEAD, so `merge --abort` cannot undo it; `reset --merge` restores the index.
    if (result.exitCode === 1) return conflictOrFailure(dir, args, result, ['reset', '--merge']);
    const staged = await runGit(['diff', '--cached', '--quiet'], { cwd: dir, okExitCodes: [0, 1] });
    // Nothing to commit: the target already has every change (e.g. a delivery repeated after an interruption).
    if (staged.exitCode === 1) {
      try {
        await runGit([...identity, 'commit', '--quiet', ...noVerify, '-m', message], { cwd: dir });
      } catch (err) {
        // A rejecting hook leaves the squashed changes staged in the user's worktree; put it back as it was.
        await runGit(['reset', '--merge'], { cwd: dir });
        throw err;
      }
    }
    return { merged: true, commitSha: await head(dir) };
  }
  const args = [...identity, 'merge', '--no-ff', ...noVerify, '--quiet', '-m', message, '--end-of-options', source];
  const result = await runGit(args, { cwd: dir, ...accept });
  if (result.exitCode === 1) return conflictOrFailure(dir, args, result, ['merge', '--abort']);
  return { merged: true, commitSha: await head(dir) };
}

/** Runs the strategy in `dir`, where the target branch is checked out and clean. */
async function mergeIn(dir: string, input: LocalMergeInput): Promise<MergeOutcome> {
  const accept = { okExitCodes: [0, 1] };
  switch (input.strategy) {
    case DeliveryStrategy.Squash:
    case DeliveryStrategy.Merge:
      return mergeOrSquash(
        dir,
        input.branch,
        input.strategy === DeliveryStrategy.Squash,
        input.message,
        backend(input.identity),
      );
    case DeliveryStrategy.Rebase: {
      // A branch that already contains the target (a resolved conflict merged it in) is fast-forwarded as it is:
      // rebasing it would replay the resolved conflict.
      if (!(await isAncestor(dir, input.targetBranch, input.branch))) {
        const args = [
          ...backendCommitter(input.identity),
          'rebase',
          '--quiet',
          '--no-verify',
          '--end-of-options',
          input.targetBranch,
        ];
        const result = await runGit(args, { cwd: input.worktreePath, ...accept });
        if (result.exitCode === 1) return conflictOrFailure(input.worktreePath, args, result, ['rebase', '--abort']);
      }
      await runGit(['merge', '--ff-only', '--quiet', '--end-of-options', input.branch], { cwd: dir });
      return { merged: true, commitSha: await head(dir) };
    }
  }
}

/**
 * Runs `merge` where `target` is checked out, under the repository lock; when it is checked out nowhere, in a
 * temporary worktree removed afterwards. `ready` checks the worktree holding the target inside the same lock, right
 * before the merge: a check made before the lock could be outdated by then, and a squash commits the whole index.
 */
function inTargetWorktree(
  locks: RepoLocks,
  repoPath: string,
  target: string,
  ready: (holder: string) => Promise<void>,
  merge: (dir: string) => Promise<MergeOutcome>,
): Promise<MergeOutcome> {
  return locks.run(repoPath, async () => {
    const holder = await targetHolder(repoPath, target);
    if (holder !== undefined) {
      await ready(holder);
      return merge(holder);
    }
    const parent = await mkdtemp(join(tmpdir(), 'aw-merge-'));
    const dir = join(parent, 'target');
    try {
      await runGit(['worktree', 'add', '--quiet', dir, target], { cwd: repoPath });
      try {
        return await merge(dir);
      } finally {
        await runGit(['worktree', 'remove', '--force', dir], { cwd: repoPath });
      }
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
}

/** Merges the task branch into the target in the main repository (09 §7). */
export function mergeLocally(locks: RepoLocks, input: LocalMergeInput): Promise<MergeOutcome> {
  return inTargetWorktree(
    locks,
    input.repoPath,
    input.targetBranch,
    (holder) => assertTargetClean(holder, input.targetBranch),
    (dir) => mergeIn(dir, input),
  );
}

/**
 * The Git workbench's merge (27 §3.5): `source` (any branch or commit) into the local branch `target`, as the user.
 * `ready` is the caller's check of the target's worktree; conflicts are aborted and reported, the target unchanged.
 */
export function mergeAsUser(
  locks: RepoLocks,
  input: { repoPath: string; source: string; target: string; strategy: GitMergeStrategy; message: string },
  ready: (holder: string) => Promise<void>,
): Promise<MergeOutcome> {
  return inTargetWorktree(locks, input.repoPath, input.target, ready, (dir) =>
    mergeOrSquash(dir, input.source, input.strategy === GitMergeStrategy.Squash, input.message, USER),
  );
}
