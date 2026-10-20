import { AppError, type DiffDTO, ErrorCode, type FileDiffDTO, WorktreeStatus } from '@aw/shared';
import {
  diffCommits,
  diffCommitsFile,
  diffWorktree,
  diffWorktreeFile,
  limitDiff,
  mergeBase,
  runGit,
} from '../git/index.ts';
import type { Worktree } from '../worktrees/index.ts';
import type { Task } from './tasks.repo.ts';
import type { TaskState, TasksServiceDeps } from './tasks.state.ts';

/**
 * What the task changed is compared with the merge base of its branch and the target branch (11 §5): the base
 * commit at first, the target's tip once a conflict resolution merged the target into the branch.
 */
export function taskDiffBase(worktreePath: string, targetBranch: string): Promise<string> {
  return mergeBase(worktreePath, `refs/heads/${targetBranch}`, 'HEAD');
}

/** Diffs of a task's worktree (11 §5) and of its nodes' commits (11 §6). */
export function createTaskDiffs(deps: TasksServiceDeps, state: TaskState) {
  const { worktrees, nodes, projects } = deps;

  function readyWorktree(task: Task): Worktree {
    const worktree = worktrees.findByTask(task.id);
    if (worktree?.status !== WorktreeStatus.Ready) {
      throw new AppError(ErrorCode.NotFound, `Task ${task.key} has no worktree`, { taskId: task.id });
    }
    return worktree;
  }

  /** The node's commit and its parent, in the project repository (commits outlive the worktree). */
  async function nodeCommit(taskId: string, nodeId: string) {
    const node = nodes.detail(taskId, nodeId);
    const repo = projects.getRecord(state.get(taskId).projectId).repoPath;
    if (node.commitSha === null) return { repo, commit: null, parent: null };
    const parent = (await runGit(['rev-parse', `${node.commitSha}^`], { cwd: repo })).stdout.trim();
    return { repo, commit: node.commitSha, parent };
  }

  return {
    async diff(taskId: string): Promise<DiffDTO> {
      const task = state.get(taskId);
      const worktree = readyWorktree(task);
      const base = await taskDiffBase(worktree.path, task.baseBranch);
      return { base, files: await diffWorktree(worktree.path, base) };
    },

    async diffFile(taskId: string, path: string): Promise<FileDiffDTO> {
      const task = state.get(taskId);
      const worktree = readyWorktree(task);
      const base = await taskDiffBase(worktree.path, task.baseBranch);
      return limitDiff(path, await diffWorktreeFile(worktree.path, base, path));
    },

    async nodeDiff(taskId: string, nodeId: string): Promise<DiffDTO> {
      const { repo, commit, parent } = await nodeCommit(taskId, nodeId);
      if (commit === null || parent === null) return { base: null, files: [] };
      return { base: parent, files: await diffCommits(repo, parent, commit) };
    },

    async nodeDiffFile(taskId: string, nodeId: string, path: string): Promise<FileDiffDTO> {
      const { repo, commit, parent } = await nodeCommit(taskId, nodeId);
      if (commit === null || parent === null) {
        throw new AppError(ErrorCode.NotFound, `Step ${nodeId} made no commit`, { nodeId });
      }
      return limitDiff(path, await diffCommitsFile(repo, parent, commit, path));
    },
  };
}
