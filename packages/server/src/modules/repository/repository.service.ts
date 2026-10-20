import {
  AppError,
  type DiffDTO,
  ErrorCode,
  type FileDiffDTO,
  type GitBranchDTO,
  type GitCommitDetailDTO,
  type GitCommitDTO,
  type GitFileDTO,
  type GitStatusDTO,
  type GitTreeEntryDTO,
  type GitWorktreeDTO,
  isTerminalState,
  taskMachine,
  WorktreeStatus,
} from '@aw/shared';
import type { Logger } from '../../core/logger.ts';
import {
  diffCommits,
  diffCommitsFile,
  distance,
  fetchAll,
  limitDiff,
  listBranches,
  listWorktrees,
  type RepoLocks,
  readCommit,
  readFile,
  readLog,
  readStatus,
  readTree,
  runGit,
} from '../git/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { Task, TasksService } from '../tasks/index.ts';
import type { WorktreesService } from '../worktrees/index.ts';

export type RepositoryServiceDeps = {
  projects: ProjectsService;
  tasks: TasksService;
  worktrees: WorktreesService;
  locks: RepoLocks;
  log: Logger;
};

const taskRef = (task: Task) => ({ id: task.id, key: task.key, status: task.status });

/** The Git console (11 §8): what the project repository holds, read with machine formats (06 §2.3). */
export function createRepositoryService({ projects, tasks, worktrees, locks, log }: RepositoryServiceDeps) {
  const repoOf = (projectId: string) => projects.getRecord(projectId).repoPath;

  /** Refs and paths come from the user: one that names nothing is a 404, not a failed git command. */
  async function requireObject(repo: string, object: string): Promise<void> {
    const { exitCode } = await runGit(['cat-file', '-e', '--end-of-options', object], {
      cwd: repo,
      okExitCodes: [0, 1, 128],
    });
    if (exitCode !== 0) throw new AppError(ErrorCode.NotFound, `${object} does not exist`, { object });
  }

  async function worktreeList(projectId: string): Promise<GitWorktreeDTO[]> {
    const project = projects.getRecord(projectId);
    const records = worktrees.listByProject(projectId);
    const byTask = new Map(tasks.listByProject(projectId).map((t) => [t.id, t]));
    const listed = await listWorktrees(project.repoPath);
    return Promise.all(
      listed.map(async (wt, index) => {
        const record = records.find((r) => r.path === wt.path && r.status !== WorktreeStatus.Removed);
        const task = record === undefined ? undefined : byTask.get(record.taskId);
        const away = wt.prunable;
        const ahead =
          away || wt.branch === null ? null : await distance(project.repoPath, project.defaultBranch, wt.branch);
        return {
          path: wt.path,
          main: index === 0,
          branch: wt.branch,
          commit: wt.commit,
          locked: wt.locked,
          prunable: wt.prunable,
          dirty: away ? null : !(await readStatus(wt.path)).clean,
          ahead: ahead?.ahead ?? null,
          behind: ahead?.behind ?? null,
          managed: record !== undefined,
          task: task === undefined ? null : taskRef(task),
        };
      }),
    );
  }

  return {
    status: (projectId: string): Promise<GitStatusDTO> => readStatus(repoOf(projectId)),

    async branches(projectId: string): Promise<GitBranchDTO[]> {
      const byBranch = new Map(
        tasks.listByProject(projectId).flatMap((t) => (t.branch === null ? [] : [[t.branch, taskRef(t)] as const])),
      );
      return (await listBranches(repoOf(projectId))).map((b) => ({
        ...b,
        task: b.remote ? null : (byBranch.get(b.name) ?? null),
      }));
    },

    /** Pages are offsets into the log: the cursor is the number of commits already shown. */
    async log(
      projectId: string,
      ref: string,
      limit: number,
      cursor: string | undefined,
    ): Promise<{ items: GitCommitDTO[]; nextCursor: string | null }> {
      const repo = repoOf(projectId);
      await requireObject(repo, `${ref}^{commit}`);
      const skip = cursor === undefined ? 0 : Number(cursor);
      const commits = await readLog(repo, ref, limit + 1, skip);
      return {
        items: commits.slice(0, limit),
        nextCursor: commits.length > limit ? String(skip + limit) : null,
      };
    },

    async commit(projectId: string, sha: string): Promise<GitCommitDetailDTO> {
      const repo = repoOf(projectId);
      await requireObject(repo, `${sha}^{commit}`);
      return readCommit(repo, sha);
    },

    async diff(projectId: string, from: string, to: string): Promise<DiffDTO> {
      const repo = repoOf(projectId);
      await Promise.all([requireObject(repo, `${from}^{commit}`), requireObject(repo, `${to}^{commit}`)]);
      return { base: from, files: await diffCommits(repo, from, to) };
    },

    async diffFile(projectId: string, from: string, to: string, path: string): Promise<FileDiffDTO> {
      const repo = repoOf(projectId);
      await Promise.all([requireObject(repo, `${from}^{commit}`), requireObject(repo, `${to}^{commit}`)]);
      return limitDiff(path, await diffCommitsFile(repo, from, to, path));
    },

    async tree(projectId: string, ref: string, path: string): Promise<GitTreeEntryDTO[]> {
      const repo = repoOf(projectId);
      const dir = path.replace(/^\/+|\/+$/g, '');
      await requireObject(repo, `${ref}:${dir}`);
      return readTree(repo, ref, dir);
    },

    async file(projectId: string, ref: string, path: string): Promise<GitFileDTO> {
      const repo = repoOf(projectId);
      await requireObject(repo, `${ref}:${path}`);
      return readFile(repo, ref, path);
    },

    async fetch(projectId: string): Promise<void> {
      const repo = repoOf(projectId);
      await locks.run(repo, () => fetchAll(repo));
    },

    worktrees: worktreeList,

    /**
     * Worktrees of finished tasks whose removal did not happen (or failed) are removed, keeping their branches; then
     * git forgets worktrees whose directories are gone (11 §8).
     */
    async prune(projectId: string): Promise<GitWorktreeDTO[]> {
      const { repoPath } = projects.getRecord(projectId);
      const finished = new Set(
        tasks
          .listByProject(projectId)
          .filter((t) => isTerminalState(taskMachine, t.status))
          .map((t) => t.id),
      );
      const leftovers = worktrees
        .listByProject(projectId)
        .filter(
          (w) => finished.has(w.taskId) && (w.status === WorktreeStatus.Ready || w.status === WorktreeStatus.Error),
        );
      for (const worktree of leftovers) {
        await worktrees.remove(worktree, { repoPath, deleteBranch: false });
        log.info({ taskId: worktree.taskId, path: worktree.path }, 'leftover worktree removed');
      }
      await locks.run(repoPath, () => runGit(['worktree', 'prune'], { cwd: repoPath }));
      return worktreeList(projectId);
    },
  };
}
export type RepositoryService = ReturnType<typeof createRepositoryService>;
