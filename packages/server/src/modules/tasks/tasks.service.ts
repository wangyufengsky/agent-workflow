import {
  AppError,
  type AttemptDTO,
  type CreateTaskRequest,
  type DeliverRequest,
  ErrorCode,
  type ListTasksQuery,
  type NodeDetailDTO,
  type PlanDTO,
  type PlanGraph,
  type RequestChangesRequest,
  type ResultNext,
  resolveTaskDisplayGroup,
  ServerEventType,
  type SubmitResultInput,
  TASK_STATUSES,
  type TaskDetailDTO,
  TaskStatus,
  type TaskSummaryDTO,
} from '@aw/shared';
import type { EventBus } from '../../core/event-bus.ts';
import { listTaskEvents } from '../timeline/index.ts';
import { createTaskActions } from './tasks.actions.ts';
import { createTaskChanges } from './tasks.changes.ts';
import { createTaskContext } from './tasks.context.ts';
import { createTaskDelivery } from './tasks.delivery.ts';
import { createTaskDiffs } from './tasks.diff.ts';
import { createTaskLifecycle } from './tasks.lifecycle.ts';
import type { StatusMatch } from './tasks.repo.ts';
import { createTaskResults } from './tasks.result.ts';
import { createTaskReview } from './tasks.review.ts';
import { createTaskState, type TasksServiceDeps } from './tasks.state.ts';

/** Tasks (09 §2): lifecycle, the context their attempts read, decisions on their items, and their views. */
export function createTasksService(deps: TasksServiceDeps & { events: EventBus }) {
  const { db, plans, nodes, attempts, inbox, worktrees, workflows } = deps;
  const state = createTaskState(deps);
  const lifecycle = createTaskLifecycle(deps, state);
  const results = createTaskResults(deps, state);
  const context = createTaskContext(deps, state);
  const actions = createTaskActions(deps, state, lifecycle);
  const diffs = createTaskDiffs(deps, state);
  const delivery = createTaskDelivery(deps, state);
  const changes = createTaskChanges(deps, state, delivery.current);
  const review = createTaskReview(deps, state, changes);

  // A task's summary shows its open attention items, working steps and progress line; keep it current.
  deps.events.subscribe((event) => {
    const taskId =
      event.type === ServerEventType.InboxUpdated
        ? event.data.item.taskId
        : event.type === ServerEventType.NodeUpdated
          ? event.data.taskId
          : event.type === ServerEventType.AttemptUpdated
            ? event.data.taskId
            : null;
    if (taskId !== null) state.publish(taskId);
  });

  function detail(id: string): TaskDetailDTO {
    const task = state.get(id);
    const workflow = workflows.get(task.workflowId);
    const worktree = worktrees.findByTask(id);
    const plan = task.status === TaskStatus.PlanReview ? plans.draft(id) : plans.confirmed(id);
    return {
      ...state.summary(task),
      requirement: task.requirement,
      failedPhase: task.failedPhase,
      failure: task.failure,
      workflow: {
        id: workflow.id,
        key: workflow.key,
        name: workflow.name,
        version: workflow.version,
        planning: workflow.planning,
        deliverable: workflow.deliverable,
      },
      checkpoints: task.checkpoints,
      git: {
        baseBranch: task.baseBranch,
        baseCommit: task.baseCommit,
        branch: task.branch,
        worktreePath: worktree?.path ?? null,
        worktreeStatus: worktree?.status ?? null,
      },
      plan: plan ?? null,
      draftPlan: task.status === TaskStatus.Paused ? (plans.draft(id) ?? null) : null,
      nodes: nodes.summaries(id),
      activeAttempts: attempts.listActive(id),
      openInbox: inbox.listOpen({ taskId: id }),
      result: task.result,
      lastDelivery: delivery.lastDelivery(id),
      pullRequest: review.pullRequestOf(id),
    };
  }

  return {
    detail,
    /** A page of task summaries (11 §5); the display group is decided in SQL so that pages stay full. */
    list({ projectId, status, displayGroup, limit, cursor }: ListTasksQuery): {
      items: TaskSummaryDTO[];
      nextCursor: string | null;
    } {
      const attention = state.attentionTaskIds();
      const statuses = status === undefined ? TASK_STATUSES : [status];
      const oneOf =
        status === undefined && displayGroup === undefined
          ? undefined
          : statuses.flatMap((s): StatusMatch[] => {
              const without = displayGroup === undefined || resolveTaskDisplayGroup(s, false) === displayGroup;
              const withAttention = displayGroup === undefined || resolveTaskDisplayGroup(s, true) === displayGroup;
              if (without && withAttention) return [{ status: s, attention: 'any' }];
              if (without) return [{ status: s, attention: 'without' }];
              return withAttention ? [{ status: s, attention: 'with' }] : [];
            });
      const [updatedAt, seq] = cursor === undefined ? [] : cursor.split('.').map(Number);
      const rows = state.repo.page({
        projectId,
        oneOf,
        attention,
        after: updatedAt === undefined || seq === undefined ? undefined : { updatedAt, seq },
        limit: limit + 1,
      });
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: state.summaries(page),
        nextCursor: rows.length > limit && last !== undefined ? `${last.updatedAt}.${last.seq}` : null,
      };
    },
    /** Summaries of the given tasks, in the given order (batches 20 §4, quality and usage 19 §4). */
    summariesOf(ids: readonly string[]): TaskSummaryDTO[] {
      const byId = new Map(state.repo.list({ ids }).map((task) => [task.id, task]));
      return state.summaries(
        ids.map((id) => {
          const task = byId.get(id);
          if (task === undefined) throw new AppError(ErrorCode.TaskNotFound, `Task ${id} not found`, { id });
          return task;
        }),
      );
    },
    /** The task's current round's latest delivery (`TaskDetailDTO.lastDelivery`). */
    lastDelivery: (id: string) => delivery.current(id),
    /** Tasks in the given states, for the scheduler. */
    listByStatus: (statuses: readonly TaskStatus[]) => state.repo.list({ statuses }),
    /** Every task of a project, for the Git console. */
    listByProject: (projectId: string) => state.repo.list({ projectId }),
    timeline: (id: string, afterId: number) => {
      state.get(id);
      return listTaskEvents(db, id, afterId);
    },

    async create(input: CreateTaskRequest): Promise<TaskDetailDTO> {
      const baseBranch = await lifecycle.checkCreate(input);
      const id = lifecycle.insertDraft({ ...input, baseBranch });
      if (input.start !== false) lifecycle.start(id);
      return detail(id);
    },
    /** Creating several tasks in one transaction (batches, 20 §2): check once, insert drafts, start after commit. */
    checkCreate: lifecycle.checkCreate,
    insertDraft: lifecycle.insertDraft,
    start(id: string): TaskDetailDTO {
      lifecycle.start(id);
      return detail(id);
    },
    retry(id: string): TaskDetailDTO {
      lifecycle.retry(id);
      return detail(id);
    },
    async cancel(id: string, keepBranch: boolean): Promise<TaskDetailDTO> {
      await lifecycle.cancel(id, keepBranch);
      return detail(id);
    },
    async deliver(id: string, request: Omit<DeliverRequest, 'id'>): Promise<TaskDetailDTO> {
      await delivery.deliver(id, request);
      return detail(id);
    },
    async requestChanges(
      id: string,
      reason: RequestChangesRequest['reason'],
      feedback: string | undefined,
    ): Promise<TaskDetailDTO> {
      await changes.requestChanges(id, reason, feedback);
      return detail(id);
    },
    reviewComments: review.reviewComments,
    async reviseFromReview(
      id: string,
      commentIds: readonly string[],
      note: string | undefined,
    ): Promise<TaskDetailDTO> {
      await review.reviseFromReview(id, commentIds, note);
      return detail(id);
    },
    confirmPlan(id: string, version: number): TaskDetailDTO {
      lifecycle.confirmPlan(id, version);
      return detail(id);
    },
    replan(id: string, feedback: string): TaskDetailDTO {
      lifecycle.replan(id, feedback);
      return detail(id);
    },
    saveDraftPlan: (id: string, baseVersion: number, graph: PlanGraph): PlanDTO =>
      lifecycle.saveDraft(id, baseVersion, graph),
    pause(id: string): TaskDetailDTO {
      lifecycle.pause(id);
      return detail(id);
    },
    resume(id: string): TaskDetailDTO {
      lifecycle.resume(id);
      return detail(id);
    },

    node: (taskId: string, nodeId: string): NodeDetailDTO => nodes.detail(taskId, nodeId),
    async acceptNode(taskId: string, nodeId: string): Promise<NodeDetailDTO> {
      await actions.acceptNode(taskId, nodeId);
      return nodes.detail(taskId, nodeId);
    },
    rejectNode(taskId: string, nodeId: string, feedback: string): NodeDetailDTO {
      nodes.detail(taskId, nodeId);
      nodes.reject(nodeId, feedback);
      return nodes.detail(taskId, nodeId);
    },
    skipNode(taskId: string, nodeId: string): NodeDetailDTO {
      nodes.detail(taskId, nodeId);
      nodes.skip(nodeId);
      return nodes.detail(taskId, nodeId);
    },
    retryNode(taskId: string, nodeId: string, feedback: string | undefined): NodeDetailDTO {
      nodes.detail(taskId, nodeId);
      nodes.retry(nodeId, feedback);
      return nodes.detail(taskId, nodeId);
    },

    /** `submit_result` of a task's execute attempt (12 §6.5). */
    async submitResult(attempt: AttemptDTO, input: SubmitResultInput): Promise<ResultNext> {
      if (attempt.taskId === null) throw new Error(`Attempt ${attempt.id} belongs to no task`);
      return nodes.submitResult(attempt, input, state.runContext(state.get(attempt.taskId)));
    },

    ...diffs,
    resolveInbox: actions.resolveInbox,
    deleteProject: actions.deleteProject,
    deleteWorkflow: actions.deleteWorkflow,
    deleteRole: actions.deleteRole,
    ...context,
    submitPlan: lifecycle.submitPlan,
    startPlanning: lifecycle.startPlanning,
    finishRunning: results.finishRunning,
    failRunning: results.failRunning,
    runContext: (taskId: string) => state.runContext(state.get(taskId)),
    /** Startup: deliveries cut short go back to review, preparations continue (03 §2.1). */
    recover(): void {
      delivery.recover();
      lifecycle.recover();
    },
  };
}
export type TasksService = ReturnType<typeof createTasksService>;
