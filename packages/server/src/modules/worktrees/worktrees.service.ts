import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AppError,
  BRANCH_PREFIX,
  BRANCH_SLUG_MAX,
  ErrorCode,
  toSlug,
  transition,
  WorktreeEvent,
  WorktreeStatus,
  worktreeMachine,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { Logger } from '../../core/logger.ts';
import { branchExists, type RepoLocks, runGit } from '../git/index.ts';
import type { SettingsService } from '../settings/index.ts';
import { createWorktreesRepo, type Worktree } from './worktrees.repo.ts';

export type WorktreesServiceDeps = {
  db: Db;
  clock: Clock;
  log: Logger;
  locks: RepoLocks;
  settings: SettingsService;
  dataDir: string;
};

export type CreateWorktreeInput = {
  taskId: string;
  taskKey: string;
  title: string;
  projectId: string;
  projectSlug: string;
  repoPath: string;
  baseBranch: string;
};

/** `aw/<taskKey>-<slug>`; titles without ASCII letters or digits give just `aw/<taskKey>` (08 §4.1). */
export function branchName(taskKey: string, title: string): string {
  const slug = toSlug(title, BRANCH_SLUG_MAX);
  return `${BRANCH_PREFIX}${taskKey}${slug === '' ? '' : `-${slug}`}`;
}

const messageOf = (err: AppError) => {
  const stderr = err.details?.stderr;
  return typeof stderr === 'string' && stderr !== '' ? stderr : err.message;
};

/** One worktree and branch per task (D08, D20); refs and the worktree list change only under the repository lock. */
export function createWorktreesService({ db, clock, log, locks, settings, dataDir }: WorktreesServiceDeps) {
  const repo = createWorktreesRepo(db);

  function mustFind(id: string): Worktree {
    const worktree = repo.find(id);
    if (worktree === undefined) throw new Error(`Worktree ${id} disappeared`);
    return worktree;
  }

  function move(worktree: Worktree, event: WorktreeEvent, changes: { error?: string; removedAt?: number | null } = {}) {
    const to = transition(worktreeMachine, worktree.status, event);
    repo.updateStatus(worktree.id, worktree.status, to, changes);
    log.info({ taskId: worktree.taskId, from: worktree.status, to, event }, 'worktree transition');
    return mustFind(worktree.id);
  }

  async function remove(worktree: Worktree, options: { repoPath: string; deleteBranch: boolean }): Promise<void> {
    const removing = move(worktree, WorktreeEvent.Remove);
    try {
      await locks.run(options.repoPath, async () => {
        const cwd = options.repoPath;
        if (existsSync(removing.path)) await runGit(['worktree', 'remove', '--force', removing.path], { cwd });
        else await runGit(['worktree', 'prune'], { cwd });
        if (options.deleteBranch && (await branchExists(cwd, removing.branch))) {
          await runGit(['branch', '-D', removing.branch], { cwd });
        }
      });
    } catch (err) {
      if (err instanceof AppError) move(removing, WorktreeEvent.RemoveFailed, { error: messageOf(err) });
      throw err;
    }
    move(removing, WorktreeEvent.Removed, { removedAt: clock.now() });
  }

  return {
    findByTask: (taskId: string): Worktree | undefined => repo.findByTask(taskId),
    listByProject: (projectId: string): Worktree[] => repo.listByProject(projectId),

    /** `<root>/<projectSlug>/<taskKey>` on a new branch from the base branch's current commit. */
    async create(input: CreateWorktreeInput): Promise<Worktree> {
      const root = settings.get('worktree.rootDir') ?? join(dataDir, 'worktrees');
      const parent = join(root, input.projectSlug);
      const branch = branchName(input.taskKey, input.title);
      return locks.run(input.repoPath, async () => {
        const cwd = input.repoPath;
        // Stored with symlinks resolved, as git reports it (`git worktree list`), so the two can be matched.
        await mkdir(parent, { recursive: true });
        const path = join(await realpath(parent), input.taskKey);
        const { stdout } = await runGit(['rev-parse', '--verify', `refs/heads/${input.baseBranch}^{commit}`], { cwd });
        const id = randomUUID();
        repo.insert({
          id,
          projectId: input.projectId,
          taskId: input.taskId,
          path,
          branch,
          baseCommit: stdout.trim(),
          status: WorktreeStatus.Creating,
          error: null,
          createdAt: clock.now(),
          removedAt: null,
        });
        try {
          await runGit(['worktree', 'add', '-b', branch, path, stdout.trim()], { cwd });
        } catch (err) {
          if (!(err instanceof AppError)) throw err;
          move(mustFind(id), WorktreeEvent.CreateFailed, { error: messageOf(err) });
          throw new AppError(ErrorCode.WorktreeCreateFailed, 'git worktree add failed', {
            path,
            branch,
            ...err.details,
          });
        }
        return move(mustFind(id), WorktreeEvent.Created);
      });
    },

    remove,

    /**
     * Brings a removed worktree back at its path on its kept branch (21 §4.2): a task delivered as a pull request
     * is revised again. The record stays the task's one worktree.
     */
    async restore(worktree: Worktree, repoPath: string): Promise<Worktree> {
      return locks.run(repoPath, async () => {
        const creating = move(worktree, WorktreeEvent.Restore, { removedAt: null });
        try {
          await runGit(['worktree', 'add', creating.path, creating.branch], { cwd: repoPath });
        } catch (err) {
          if (!(err instanceof AppError)) throw err;
          move(creating, WorktreeEvent.CreateFailed, { error: messageOf(err) });
          throw new AppError(ErrorCode.WorktreeCreateFailed, 'git worktree add failed', {
            path: creating.path,
            branch: creating.branch,
            ...err.details,
          });
        }
        return move(creating, WorktreeEvent.Created);
      });
    },

    /**
     * Clears a worktree that never became ready (creation failed, or the app stopped while creating) so the task can
     * prepare again: leftovers are removed and the record deleted, since a task has at most one worktree.
     */
    async discard(worktree: Worktree, repoPath: string): Promise<void> {
      if (worktree.status !== WorktreeStatus.Removed) {
        const failed =
          worktree.status === WorktreeStatus.Creating
            ? move(worktree, WorktreeEvent.CreateFailed, { error: 'interrupted while creating' })
            : worktree;
        await remove(failed, { repoPath, deleteBranch: true });
      }
      repo.delete(worktree.id);
    },
  };
}
export type WorktreesService = ReturnType<typeof createWorktreesService>;
