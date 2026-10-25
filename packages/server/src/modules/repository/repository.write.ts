import {
  AppError,
  BRANCH_PREFIX,
  ErrorCode,
  GIT_PUSH_COMMITS_SHOWN,
  type GitCommitDTO,
  type GitMergeRequest,
  type GitMergeResultDTO,
  type GitPushPreviewDTO,
  isTerminalState,
  type TaskDetailDTO,
  taskMachine,
} from '@aw/shared';
import { mergeAsUser, targetHolder } from '../delivery/index.ts';
import {
  branchExists,
  commit,
  createBranch,
  deleteBranch,
  diffStaged,
  fastForward,
  fetchRemote,
  hasStagedChanges,
  isValidBranchName,
  listBranches,
  listWorktrees,
  originEnv,
  pushToOrigin,
  type RepoLocks,
  readIdentity,
  readLog,
  readOperation,
  readRevisions,
  readStatus,
  readUpstream,
  runGit,
  stage,
  switchBranch,
  unstage,
} from '../git/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { TasksService } from '../tasks/index.ts';

export type RepositoryWriteDeps = { projects: ProjectsService; tasks: TasksService; locks: RepoLocks };

/**
 * The user's own Git operations in the Git workbench (27 §3, D108), run by the backend on the user's click: only in
 * the project's main worktree and on branches no unfinished task owns (27 §5), each under the repository lock.
 */
export function createRepositoryWrites({ projects, tasks, locks }: RepositoryWriteDeps) {
  const repoOf = (projectId: string) => projects.getRecord(projectId).repoPath;

  /** A task's branch stays the task's until it finishes: its merges and pushes go through delivery (27 §5). */
  function assertNotTaskOwned(projectId: string, branch: string): void {
    const task = tasks
      .listByProject(projectId)
      .find((t) => t.branch === branch && !isTerminalState(taskMachine, t.status));
    if (task !== undefined) {
      throw new AppError(ErrorCode.GitBranchOwnedByTask, `Branch ${branch} belongs to task ${task.key}`, {
        branch,
        task: { id: task.id, key: task.key },
      });
    }
  }

  async function assertNoOperation(dir: string): Promise<void> {
    const operation = await readOperation(dir);
    if (operation !== null) {
      throw new AppError(ErrorCode.GitOperationInProgress, `A ${operation} is in progress`, { operation, path: dir });
    }
  }

  /** Switching and fast-forwarding never touch uncommitted work: there is no stash (D108). */
  async function assertClean(dir: string): Promise<void> {
    const status = await readStatus(dir);
    if (!status.clean) {
      throw new AppError(ErrorCode.WorktreeDirty, 'The worktree has uncommitted changes', {
        path: dir,
        files: status.files.map((f) => f.path),
      });
    }
  }

  async function assertLocalBranch(repo: string, branch: string): Promise<void> {
    if (!(await branchExists(repo, branch))) {
      throw new AppError(ErrorCode.NotFound, `Branch ${branch} does not exist`, { object: branch });
    }
  }

  /** A branch checked out in another worktree can be neither switched to nor deleted. */
  async function assertNotCheckedOutElsewhere(repo: string, branch: string): Promise<void> {
    const [, ...others] = await listWorktrees(repo);
    const holder = others.find((w) => w.branch === branch);
    if (holder !== undefined) {
      throw new AppError(ErrorCode.GitBranchInUse, `Branch ${branch} is checked out in ${holder.path}`, {
        branch,
        path: holder.path,
      });
    }
  }

  /**
   * The project's token, or the global one of its platform (D155), for pushing over HTTPS (D53); without either git
   * uses the user's own credentials.
   */
  async function remoteEnv(projectId: string): Promise<NodeJS.ProcessEnv> {
    return originEnv((await projects.findHosting(projectId))?.gitAuthorization());
  }

  return {
    async stage(projectId: string, paths: readonly string[]): Promise<void> {
      const repo = repoOf(projectId);
      await locks.run(repo, async () => {
        await assertNoOperation(repo);
        await stage(repo, paths);
      });
    },

    /** A staged rename is unstaged whole: its old path too, or the old file would stay staged as deleted. */
    async unstage(projectId: string, paths: readonly string[]): Promise<void> {
      const repo = repoOf(projectId);
      await locks.run(repo, async () => {
        await assertNoOperation(repo);
        const renamedFrom = (await diffStaged(repo)).flatMap((f) =>
          f.oldPath !== undefined && paths.includes(f.path) ? [f.oldPath] : [],
        );
        await unstage(repo, [...paths, ...renamedFrom]);
      });
    },

    /** Commits the staged changes as the user (27 §3.2). */
    async commit(projectId: string, message: string): Promise<GitCommitDTO> {
      const repo = repoOf(projectId);
      const sha = await locks.run(repo, async () => {
        await assertNoOperation(repo);
        if ((await readIdentity(repo)) === null) {
          throw new AppError(ErrorCode.GitIdentityMissing, 'git has no user.name / user.email', { path: repo });
        }
        if (!(await hasStagedChanges(repo))) {
          throw new AppError(ErrorCode.GitNothingToCommit, 'Nothing is staged', { path: repo });
        }
        return commit(repo, message);
      });
      const [created] = await readLog(repo, sha, 1, 0);
      if (created === undefined) throw new Error(`git log has no commit ${sha}`);
      return created;
    },

    /** What a push would send (27 §3.3): the commits origin's branch lacks, newest first. */
    async pushPreview(projectId: string, branch: string): Promise<GitPushPreviewDTO> {
      const repo = repoOf(projectId);
      await assertLocalBranch(repo, branch);
      const remoteBranch = `origin/${branch}`;
      const exists = (await listBranches(repo)).some((b) => b.remote && b.name === remoteBranch);
      const range = exists ? [`${remoteBranch}..${branch}`] : [branch, '--not', '--remotes=origin'];
      const [commits, count] = await Promise.all([
        readRevisions(repo, range, GIT_PUSH_COMMITS_SHOWN),
        runGit(['rev-list', '--count', ...range], { cwd: repo }),
      ]);
      return { branch, remoteBranch, isNew: !exists, commits, total: Number(count.stdout.trim()) };
    },

    async push(projectId: string, branch: string): Promise<void> {
      assertNotTaskOwned(projectId, branch);
      const repo = repoOf(projectId);
      await assertLocalBranch(repo, branch);
      const env = await remoteEnv(projectId);
      await locks.run(repo, async () => {
        const upstream = await runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}@{upstream}`], {
          cwd: repo,
          okExitCodes: [0, 1, 128],
        });
        await pushToOrigin(repo, branch, { env, setUpstream: upstream.exitCode !== 0 });
      });
    },

    /** Fetches the checked-out branch's upstream and fast-forwards to it (27 §3.1); never merges. */
    async pull(projectId: string): Promise<void> {
      const repo = repoOf(projectId);
      const env = await remoteEnv(projectId);
      await locks.run(repo, async () => {
        await assertNoOperation(repo);
        await assertClean(repo);
        const upstream = await readUpstream(repo);
        if (upstream === undefined) {
          throw new AppError(ErrorCode.GitNoUpstream, 'The checked-out branch has no upstream', { path: repo });
        }
        await fetchRemote(repo, upstream.remote, env);
        await fastForward(repo, upstream.ref);
      });
    },

    async createBranch(projectId: string, name: string, startPoint: string, andSwitch: boolean): Promise<void> {
      const repo = repoOf(projectId);
      // Task branches are named by the app (`aw/<key>-<slug>`).
      if (name.startsWith(BRANCH_PREFIX) || !(await isValidBranchName(repo, name))) {
        throw new AppError(ErrorCode.ValidationFailed, `Invalid branch name ${name}`, {
          issues: [{ path: ['name'], message: `not a valid branch name, or starts with ${BRANCH_PREFIX}` }],
        });
      }
      await locks.run(repo, async () => {
        if (await branchExists(repo, name)) {
          throw new AppError(ErrorCode.GitBranchExists, `Branch ${name} already exists`, { branch: name });
        }
        await requireCommit(repo, startPoint);
        if (andSwitch) {
          await assertNoOperation(repo);
          await assertClean(repo);
        }
        await createBranch(repo, name, startPoint);
        if (andSwitch) await switchBranch(repo, name, false);
      });
    },

    /** Checks out a local branch, or a remote one as a new local tracking branch, in the main worktree. */
    async switchBranch(projectId: string, branch: string): Promise<void> {
      const repo = repoOf(projectId);
      const ref = (await listBranches(repo)).find((b) => b.name === branch);
      if (ref === undefined)
        throw new AppError(ErrorCode.NotFound, `Branch ${branch} does not exist`, { object: branch });
      const local = ref.remote ? branch.slice(branch.indexOf('/') + 1) : branch;
      if (ref.remote && (await branchExists(repo, local))) {
        throw new AppError(ErrorCode.GitBranchExists, `Branch ${local} already exists`, { branch: local });
      }
      assertNotTaskOwned(projectId, local);
      await locks.run(repo, async () => {
        await assertNoOperation(repo);
        await assertClean(repo);
        if (!ref.remote) await assertNotCheckedOutElsewhere(repo, branch);
        await switchBranch(repo, branch, ref.remote);
      });
    },

    async deleteBranch(projectId: string, name: string, force: boolean): Promise<void> {
      const project = projects.getRecord(projectId);
      const repo = project.repoPath;
      assertNotTaskOwned(projectId, name);
      await assertLocalBranch(repo, name);
      await locks.run(repo, async () => {
        const [main] = await listWorktrees(repo);
        if (name === project.defaultBranch || main?.branch === name) {
          throw new AppError(ErrorCode.GitBranchInUse, `Branch ${name} is the default or checked-out branch`, {
            branch: name,
            path: repo,
          });
        }
        await assertNotCheckedOutElsewhere(repo, name);
        await deleteBranch(repo, name, force);
      });
    },

    /**
     * Merges as the user where the target is checked out — the main worktree, clean — or in a temporary worktree
     * (27 §3.5); conflicts leave the target unchanged.
     */
    async merge(projectId: string, input: Omit<GitMergeRequest, 'id'>): Promise<GitMergeResultDTO> {
      const repo = repoOf(projectId);
      assertNotTaskOwned(projectId, input.target);
      assertNotTaskOwned(projectId, input.source);
      await assertLocalBranch(repo, input.target);
      await requireCommit(repo, input.source);
      const holder = await targetHolder(repo, input.target);
      if (holder !== undefined && holder !== repo) {
        throw new AppError(ErrorCode.GitBranchInUse, `Branch ${input.target} is checked out in ${holder}`, {
          branch: input.target,
          path: holder,
        });
      }
      const outcome = await mergeAsUser(locks, { repoPath: repo, ...input }, async (dir) => {
        await assertNoOperation(dir);
        await assertClean(dir);
      });
      return outcome.merged
        ? { merged: true, commit: outcome.commitSha }
        : { merged: false, conflictFiles: outcome.conflictFiles };
    },

    /** A merge task resolves the conflicts with AI in its own worktree (27 §3.6); the user merges its result. */
    async mergeWithAi(projectId: string, source: string, target: string): Promise<TaskDetailDTO> {
      const repo = repoOf(projectId);
      assertNotTaskOwned(projectId, target);
      assertNotTaskOwned(projectId, source);
      await assertLocalBranch(repo, target);
      await requireCommit(repo, source);
      return tasks.createMergeTask({ projectId, source, target });
    },

    /** Opens a pull request from a pushed branch, or returns the branch's open one (27 §3.1). */
    async createPullRequest(
      projectId: string,
      input: { branch: string; base: string; title: string; body: string },
    ): Promise<{ url: string; existed: boolean }> {
      assertNotTaskOwned(projectId, input.branch);
      const hosting = await projects.hostingOf(projectId);
      const open = await hosting.findOpenPullRequest(input.branch);
      if (open !== undefined) return { url: open.url, existed: true };
      const { url } = await hosting.createPullRequest({
        head: input.branch,
        base: input.base,
        title: input.title,
        body: input.body,
      });
      return { url, existed: false };
    },
  };
}
export type RepositoryWrites = ReturnType<typeof createRepositoryWrites>;

/** A ref from the user that names no commit is a 404, not a failed git command. */
async function requireCommit(repo: string, ref: string): Promise<void> {
  const { exitCode } = await runGit(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], {
    cwd: repo,
    okExitCodes: [0, 1],
  });
  if (exitCode !== 0) throw new AppError(ErrorCode.NotFound, `${ref} is not a commit`, { object: ref });
}
