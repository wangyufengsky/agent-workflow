import { lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  AppError,
  DeliveryStatus,
  DeliveryStrategy,
  DesignSectionKind,
  type DiffDTO,
  ErrorCode,
  type FileDiffDTO,
  GitImpactTargetKind,
  type TaskDesignImpactDTO,
  TaskStatus,
  WorktreeStatus,
} from '@aw/shared';
import { screenDesignImpact } from '../designs/index.ts';
import {
  commitsExist,
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
  const { worktrees, nodes, projects, deliveries, readyDesignKnowledge } = deps;

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

  /** A completed delivery is pinned to the commits recorded during that delivery. */
  async function deliveryRange(task: Task): Promise<{ repo: string; base: string; head: string } | null> {
    if (task.status !== TaskStatus.Completed) return null;
    const delivery = deliveries.latest(task.id);
    if (delivery?.status !== DeliveryStatus.Succeeded || delivery.strategy === DeliveryStrategy.ReportOnly) return null;
    const repo = projects.getRecord(task.projectId).repoPath;
    const base = delivery.diffBase;
    const head = delivery.diffHead;
    // Older deliveries did not persist the pre-delivery tip; a no-op merge can return an existing commit.
    const unavailable = () =>
      new AppError(ErrorCode.NotFound, 'Delivery diff range is unavailable', {
        taskId: task.id,
        reason: 'delivery_range_unavailable',
      });
    if (base === null || head === null) throw unavailable();
    if (!(await commitsExist(repo, [base, head]))) throw unavailable();
    return { repo, base, head };
  }

  async function diffOf(task: Task) {
    const range = await deliveryRange(task);
    if (range !== null)
      return { base: range.base, files: await diffCommits(range.repo, range.base, range.head), worktreePath: null };
    const { path } = readyWorktree(task);
    const base = await taskDiffBase(path, task.baseBranch);
    return { base, files: await diffWorktree(path, base), worktreePath: path };
  }

  return {
    async designImpact(taskId: string): Promise<TaskDesignImpactDTO | null> {
      const task = state.get(taskId);
      if (!readyDesignKnowledge.hasReadyDesign(task.projectId)) return null;
      const { base, files } = await diffOf(task);
      // 设计描述改动前的代码。只有干净快照与 Diff 基线同一提交时才精确匹配。
      const selection = readyDesignKnowledge.read(task.projectId, base);
      if (selection.knowledge === null) return null;
      const { knowledge, match } = selection;
      const { candidates, uncoveredPathSet, truncated } = screenDesignImpact(
        { ...selection, worktreeFresh: false },
        files,
      );
      const moduleCount = candidates.filter(
        ({ targetKind, targetId }) =>
          targetKind === GitImpactTargetKind.Submodule ||
          (targetKind === GitImpactTargetKind.Section &&
            knowledge.sections.get(targetId)?.kind === DesignSectionKind.Module),
      ).length;
      const transactionCount = candidates.filter(
        ({ targetKind }) => targetKind === GitImpactTargetKind.Transaction,
      ).length;
      return {
        designId: knowledge.designId,
        snapshotSha: knowledge.sourceSnapshot.commitSha,
        dirty: knowledge.sourceSnapshot.dirty,
        coverage: knowledge.coverage,
        candidates,
        uncoveredPaths: [...uncoveredPathSet],
        truncated,
        match,
        moduleCount,
        transactionCount,
      };
    },

    async diff(taskId: string): Promise<DiffDTO> {
      const task = state.get(taskId);
      const { base, files, worktreePath } = await diffOf(task);
      if (task.status !== TaskStatus.Running || worktreePath === null) return { base, files };
      let newest = -1;
      let latestPath: string | undefined;
      for (const file of files) {
        // 文件可能在 Git 列出清单之后被移动。删除取父目录的更新时间。
        const path = join(worktreePath, file.path);
        const stats = await lstat(file.status === 'deleted' ? dirname(path) : path).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined;
            throw error;
          },
        );
        if (stats !== undefined && stats.mtimeMs > newest) {
          newest = stats.mtimeMs;
          latestPath = file.path;
        }
      }
      return { base, files, latestPath };
    },

    async diffFile(taskId: string, path: string): Promise<FileDiffDTO> {
      const task = state.get(taskId);
      const range = await deliveryRange(task);
      if (range !== null) return limitDiff(path, await diffCommitsFile(range.repo, range.base, range.head, path));
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
