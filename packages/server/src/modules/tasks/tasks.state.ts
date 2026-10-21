import type { Prompts } from '@aw/builtin';
import {
  AppError,
  ATTENTION_INBOX_KINDS,
  ErrorCode,
  type ErrorInfo,
  InboxKind,
  NodeStatus,
  resolveTaskDisplayGroup,
  ServerEventType,
  TaskEvent,
  TaskEventEntity,
  type TaskFailedPhase,
  type TaskStatus,
  type TaskSummaryDTO,
  taskMachine,
  transition,
  WorktreeStatus,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { Logger } from '../../core/logger.ts';
import type { AttemptsService } from '../attempts/index.ts';
import type { DatabasesService } from '../databases/index.ts';
import type { DeliveriesService } from '../delivery/index.ts';
import type { RepoLocks } from '../git/index.ts';
import type { InboxService } from '../inbox/index.ts';
import type { KnowledgeService } from '../knowledge/index.ts';
import type { NodeRunContext, NodesService } from '../nodes/index.ts';
import type { PlansService } from '../plans/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { RolesService } from '../roles/index.ts';
import type { SettingsService } from '../settings/index.ts';
import { recordTaskEvent } from '../timeline/index.ts';
import type { WorkflowsService } from '../workflows/index.ts';
import type { WorktreesService } from '../worktrees/index.ts';
import { createTasksRepo, type Task, type TaskChanges } from './tasks.repo.ts';

export type TasksServiceDeps = {
  db: Db;
  unit: UnitOfWork;
  clock: Clock;
  log: Logger;
  settings: SettingsService;
  prompts: Prompts;
  projects: ProjectsService;
  workflows: WorkflowsService;
  roles: RolesService;
  worktrees: WorktreesService;
  plans: PlansService;
  nodes: NodesService;
  attempts: AttemptsService;
  inbox: InboxService;
  deliveries: DeliveriesService;
  databases: DatabasesService;
  knowledge: KnowledgeService;
  locks: RepoLocks;
  dataDir: string;
};

/** Nodes in these states are working on their step; their titles are the task's current step. */
const WORKING_NODE: readonly NodeStatus[] = [NodeStatus.Running, NodeStatus.WaitingInput, NodeStatus.Verifying];

/** Tasks' records, transitions and summaries, shared by the task lifecycle, context and actions. */
export function createTaskState(deps: TasksServiceDeps) {
  const { db, unit, clock, log, inbox, nodes, attempts, worktrees, projects } = deps;
  const repo = createTasksRepo(db);

  function get(id: string): Task {
    const task = repo.find(id);
    if (task === undefined) throw new AppError(ErrorCode.TaskNotFound, `Task ${id} not found`, { id });
    return task;
  }

  /** Tasks with an open question, permission or acceptance item (08 §2.2 `needs_attention`). */
  const attentionTaskIds = (): Set<string> =>
    new Set(
      inbox
        .listOpen({})
        .filter((item) => ATTENTION_INBOX_KINDS.includes(item.kind))
        .flatMap((item) => (item.taskId === null ? [] : [item.taskId])),
    );

  /** Summaries of several tasks with a fixed number of queries (06 §9: no N+1). */
  function summaries(tasks: readonly Task[]): TaskSummaryDTO[] {
    const ids = tasks.map((t) => t.id);
    const attention = attentionTaskIds();
    const working = new Map<string, string[]>();
    for (const node of nodes.listByTasks(ids).filter((n) => WORKING_NODE.includes(n.status))) {
      working.set(node.taskId, [...(working.get(node.taskId) ?? []), node.title]);
    }
    const progress = new Map<string, string>();
    for (const attempt of attempts.listActiveAll()) {
      if (attempt.taskId !== null && attempt.progress !== null) progress.set(attempt.taskId, attempt.progress);
    }
    return tasks.map((task) => ({
      id: task.id,
      key: task.key,
      title: task.title,
      status: task.status,
      displayGroup: resolveTaskDisplayGroup(task.status, attention.has(task.id)),
      project: { id: task.projectId, name: task.projectName },
      workflow: { id: task.workflowId, key: task.workflowKey, name: task.workflowName },
      currentStep: working.get(task.id)?.join('、') ?? null,
      progress: progress.get(task.id) ?? null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
    }));
  }

  const summary = (task: Task): TaskSummaryDTO => {
    const [result] = summaries([task]);
    if (result === undefined) throw new Error(`No summary for task ${task.id}`);
    return result;
  };

  function publish(taskId: string): void {
    unit.publish({ type: ServerEventType.TaskUpdated, data: summary(get(taskId)) });
  }

  /** Applies a state-machine event with its task event (09 §1). */
  function move(task: Task, event: TaskEvent, to?: TaskStatus, changes: TaskChanges = {}): Task {
    const target = transition(taskMachine, task.status, event, to);
    const now = clock.now();
    const updated = unit.transact(() => {
      repo.updateStatus(task.id, task.status, target, { ...changes, updatedAt: now });
      recordTaskEvent(db, {
        taskId: task.id,
        entity: TaskEventEntity.Task,
        entityId: task.id,
        type: event,
        fromStatus: task.status,
        toStatus: target,
        ...(changes.failure === undefined || changes.failure === null ? {} : { payload: { failure: changes.failure } }),
        createdAt: now,
      });
      return get(task.id);
    });
    log.info({ taskId: task.id, from: task.status, to: target, event }, 'task transition');
    publish(task.id);
    return updated;
  }

  /** A phase failed for good: the task waits for the user's retry or cancel (09 §2). */
  function fail(task: Task, phase: TaskFailedPhase, error: ErrorInfo): Task {
    return unit.transact(() => {
      const failed = move(task, TaskEvent.Fail, undefined, { failedPhase: phase, failure: error });
      inbox.create({
        kind: InboxKind.Failure,
        taskId: task.id,
        nodeId: null,
        attemptId: null,
        title: task.title,
        payload: { phase, error },
      });
      return failed;
    });
  }

  /** What running a node of the task needs (its worktree must be ready). */
  function runContext(task: Task): NodeRunContext {
    const worktree = worktrees.findByTask(task.id);
    if (worktree?.status !== WorktreeStatus.Ready) {
      throw new AppError(ErrorCode.StateTransitionInvalid, `Task ${task.key} has no ready worktree`, {
        taskId: task.id,
      });
    }
    const project = projects.getRecord(task.projectId);
    return {
      taskId: task.id,
      taskKey: task.key,
      taskTitle: task.title,
      requirement: task.requirement,
      directory: worktree.path,
      repoPath: project.repoPath,
      checkCommand: project.checkCommand,
      askOnUncertainty: task.checkpoints.ask_on_uncertainty,
    };
  }

  return { repo, get, attentionTaskIds, summaries, summary, publish, move, fail, runContext };
}
export type TaskState = ReturnType<typeof createTaskState>;
