import { EMPTY_SECTION, PromptName, renderTemplate } from '@aw/builtin';
import {
  AppError,
  ChangeRequestReason,
  ErrorCode,
  type ReviewCommentDTO,
  ReviewCommentKind,
  type ReviewCommentsDTO,
  TaskEvent,
  type TaskPullRequestDTO,
  taskMachine,
  transition,
} from '@aw/shared';
import { syncBranchFromOrigin } from '../delivery/index.ts';
import type { GitHostingProvider, OpenPullRequest, PlatformReviewComment } from '../hosting/index.ts';
import type { TaskChangeRequests } from './tasks.changes.ts';
import type { Task } from './tasks.repo.ts';
import type { TaskState, TasksServiceDeps } from './tasks.state.ts';

/** The comments as the AI reads them (`revise-review.md`) and as the plan version's feedback. */
export function renderReviewComments(comments: readonly PlatformReviewComment[]): string {
  return comments
    .map((c, i) => {
      const where = c.path === null ? 'General comment' : `\`${c.path}\`${c.line === null ? '' : ` line ${c.line}`}`;
      const messages = c.messages.map((m) => `**${m.author}**: ${m.body}`).join('\n\n');
      return `### ${i + 1}. ${where}\n\n${c.url}\n\n${messages}`;
    })
    .join('\n\n');
}

/**
 * Review comments of the pull request a task was delivered as, and revising the task from them (21): the comments
 * are read live from the platform, the kept branch gets its worktree back, and a revise step runs as for「再改改」.
 */
export function createTaskReview(
  deps: TasksServiceDeps,
  state: TaskState,
  changes: Pick<TaskChangeRequests, 'appendRevision'>,
) {
  const { projects, deliveries, worktrees, locks, prompts } = deps;
  const { get } = state;

  /** The task's latest pull request delivery (`TaskDetailDTO.pullRequest`). */
  function pullRequestOf(taskId: string): TaskPullRequestDTO | null {
    const delivery = deliveries.latestPullRequest(taskId);
    if (delivery === undefined) return null;
    if (delivery.prUrl === null || delivery.finishedAt === null) {
      throw new Error(`Pull request delivery ${delivery.id} succeeded without its address`);
    }
    return { url: delivery.prUrl, pushedAt: delivery.finishedAt };
  }

  async function openPullRequest(
    task: Task,
  ): Promise<{ hosting: GitHostingProvider; open: OpenPullRequest; pushedAt: number }> {
    const delivered = pullRequestOf(task.id);
    if (delivered === null || task.branch === null) {
      throw new AppError(ErrorCode.PullRequestNotOpen, 'The task was not delivered as a pull request', {
        taskId: task.id,
      });
    }
    const hosting = await projects.hostingOf(task.projectId);
    const open = await hosting.findOpenPullRequest(task.branch);
    if (open === undefined) {
      throw new AppError(ErrorCode.PullRequestNotOpen, 'The pull request was merged or closed', {
        taskId: task.id,
        branch: task.branch,
      });
    }
    return { hosting, open, pushedAt: delivered.pushedAt };
  }

  async function readComments(task: Task) {
    const pr = await openPullRequest(task);
    const items = (await pr.hosting.listReviewComments(pr.open)).map(
      (c): ReviewCommentDTO => ({
        ...c,
        // General comments cannot be resolved; those before the last push were likely handled then (D87).
        selectedByDefault: c.kind === ReviewCommentKind.Thread || c.messages.some((m) => m.createdAt > pr.pushedAt),
      }),
    );
    return { ...pr, items };
  }

  return {
    pullRequestOf,

    async reviewComments(taskId: string): Promise<ReviewCommentsDTO> {
      const { open, items } = await readComments(get(taskId));
      return { pullRequest: open, items };
    },

    async reviseFromReview(taskId: string, commentIds: readonly string[], note: string | undefined): Promise<void> {
      const task = get(taskId);
      transition(taskMachine, task.status, TaskEvent.ReviewFeedback);
      // Read again so that the AI gets the platform's text, not what the caller passed (21 §3).
      const { hosting, open, items } = await readComments(task);
      const missing = commentIds.filter((id) => !items.some((c) => c.id === id));
      if (missing.length > 0) {
        throw new AppError(ErrorCode.ValidationFailed, 'Some comments are not open on the pull request any more', {
          issues: [{ path: ['commentIds'], message: `not found or resolved: ${missing.join(', ')}` }],
        });
      }
      const chosen = items.filter((c) => commentIds.includes(c.id));
      const worktree = worktrees.findByTask(task.id);
      if (worktree === undefined) throw new Error(`Task ${task.key} delivered as a pull request has no worktree`);
      const { repoPath } = projects.getRecord(task.projectId);
      await syncBranchFromOrigin(locks, {
        repoPath,
        branch: worktree.branch,
        authorization: hosting.gitAuthorization(),
        network: await deps.gitNetwork(),
      });
      await worktrees.restore(worktree, repoPath);
      const comments = renderReviewComments(chosen);
      const instructions = renderTemplate(prompts[PromptName.ReviseReview], {
        pullRequestUrl: open.url,
        comments,
        note: note ?? EMPTY_SECTION,
        resultSummary: task.result?.summary ?? '',
      });
      changes.appendRevision(
        get(taskId),
        {
          reason: ChangeRequestReason.Review,
          instructions,
          feedback: note === undefined ? comments : `${comments}\n\n${note}`,
        },
        TaskEvent.ReviewFeedback,
      );
    },
  };
}
