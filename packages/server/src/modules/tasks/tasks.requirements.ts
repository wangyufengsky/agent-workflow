import {
  AppError,
  ErrorCode,
  type RequirementItemInput,
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
  };
}
