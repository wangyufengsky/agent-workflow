import {
  type AttemptDTO,
  type ChangeRequestReason,
  type CreateTaskRequest,
  type DeliverRequest,
  type NodeDetailDTO,
  type ResultNext,
  ServerEventType,
  type SubmitResultInput,
  type TaskDetailDTO,
  type TaskDisplayGroup,
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
import { createTaskResults } from './tasks.result.ts';
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
      nodes: nodes.summaries(id),
      activeAttempts: attempts.listActive(id),
      openInbox: inbox.listOpen({ taskId: id }),
      result: task.result,
      lastDelivery: delivery.lastDelivery(id),
    };
  }

  return {
    detail,
    list(filter: {
      projectId?: string | undefined;
      status?: TaskStatus | undefined;
      displayGroup?: TaskDisplayGroup | undefined;
      limit: number;
    }): TaskSummaryDTO[] {
      const tasks = state.repo.list({
        ...(filter.projectId === undefined ? {} : { projectId: filter.projectId }),
        ...(filter.status === undefined ? {} : { statuses: [filter.status] }),
      });
      return state
        .summaries(tasks)
        .filter((t) => filter.displayGroup === undefined || t.displayGroup === filter.displayGroup)
        .slice(0, filter.limit);
    },
    /** Tasks in the given states, for the scheduler. */
    listByStatus: (statuses: readonly TaskStatus[]) => state.repo.list({ statuses }),
    /** Every task of a project, for the Git console. */
    listByProject: (projectId: string) => state.repo.list({ projectId }),
    timeline: (id: string, afterId: number) => {
      state.get(id);
      return listTaskEvents(db, id, afterId);
    },

    async create(input: CreateTaskRequest): Promise<TaskDetailDTO> {
      return detail(await lifecycle.create(input));
    },
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
      reason: ChangeRequestReason,
      feedback: string | undefined,
    ): Promise<TaskDetailDTO> {
      await changes.requestChanges(id, reason, feedback);
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
