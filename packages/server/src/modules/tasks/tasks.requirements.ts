import {
  AppError,
  ErrorCode,
  isUnmet,
  type RequirementItemInput,
  RequirementResultSource,
  type RequirementsDeliverySummary,
  type TaskRequirementsDTO,
  TaskStatus,
  WorktreeStatus,
} from '@aw/shared';
import { runGit } from '../git/index.ts';
import type { Task } from './tasks.repo.ts';
import type { TaskState, TasksServiceDeps } from './tasks.state.ts';

/** While the AI is not working on the task (31 §2.1): before it starts, while its plan waits, and in review. */
const EDITABLE: readonly TaskStatus[] = [TaskStatus.Draft, TaskStatus.PlanReview, TaskStatus.Review];

/** A task's acceptance checklist (31): when it may change, and its items' states against the task's current commit. */
export function createTaskRequirements(deps: TasksServiceDeps, state: TaskState) {
  const { unit, worktrees, requirements } = deps;

  /** The task branch's commit in its worktree; unknown once the worktree is gone. */
  async function currentCommit(task: Task): Promise<string | null> {
    const worktree = worktrees.findByTask(task.id);
    if (worktree?.status !== WorktreeStatus.Ready) return null;
    return (await runGit(['rev-parse', 'HEAD'], { cwd: worktree.path })).stdout.trim();
  }

  async function view(taskId: string): Promise<TaskRequirementsDTO> {
    const task = state.get(taskId);
    return requirements.view(task.id, await currentCommit(task));
  }

  return {
    requirements: view,

    /** Saves the whole checklist as a new version (31 §2.1); its earlier conclusions become stale. */
    async replaceRequirements(taskId: string, items: readonly RequirementItemInput[]): Promise<TaskRequirementsDTO> {
      const task = state.get(taskId);
      if (!EDITABLE.includes(task.status)) {
        throw new AppError(ErrorCode.RequirementsNotEditable, `Task ${task.key} is ${task.status}`, {
          status: task.status,
        });
      }
      unit.transact(() => {
        requirements.save(task.id, items);
        state.publish(task.id);
      });
      return view(task.id);
    },

    /** The user's own conclusion on one item (31 §2.3): for the result being reviewed, about its current commit. */
    async decideRequirement(
      taskId: string,
      itemId: string,
      decision: { conclusion: 'pass' | 'fail' | 'waive'; note: string },
    ): Promise<TaskRequirementsDTO> {
      const task = state.get(taskId);
      const commitSha = await currentCommit(task);
      if (task.status !== TaskStatus.Review || commitSha === null) {
        throw new AppError(ErrorCode.RequirementsNotEditable, `Task ${task.key} is not waiting for review`, {
          status: task.status,
        });
      }
      if (!requirements.current(task.id)?.items.some((item) => item.id === itemId)) {
        throw new AppError(ErrorCode.NotFound, `No item ${itemId} in the checklist`, { itemId });
      }
      unit.transact(() => {
        requirements.record(task.id, [
          { itemId, source: RequirementResultSource.User, ...decision, output: null, nodeId: null, commitSha },
        ]);
        state.publish(task.id);
      });
      return view(task.id);
    },

    /**
     * Before delivery (31 §4): what the checklist says now, to keep with the delivery. Required items that are not
     * met need the user's acceptance of exactly this version; null without a checklist.
     */
    async deliveryCheck(taskId: string, acknowledged: string | undefined): Promise<RequirementsDeliverySummary | null> {
      const task = state.get(taskId);
      const commitSha = await currentCommit(task);
      const { revision, items } = requirements.view(task.id, commitSha);
      if (revision === null) return null;
      const unmet = items.filter((item) => item.required && isUnmet(item.status));
      if (unmet.length > 0 && acknowledged !== revision.id) {
        throw new AppError(ErrorCode.RequirementsUnacknowledged, 'Required checklist items are not met', {
          revisionId: revision.id,
          items: unmet.map(({ id, title, status }) => ({ id, title, status })),
        });
      }
      return {
        revisionId: revision.id,
        commitSha,
        items: items.map(({ id, title, required, status }) => ({ id, title, required, status })),
      };
    },
  };
}
