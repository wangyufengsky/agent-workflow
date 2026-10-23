import { randomUUID } from 'node:crypto';
import {
  AppError,
  type CreateScheduleRequest,
  ErrorCode,
  InboxKind,
  isTerminalState,
  type ListSchedulesQuery,
  SCHEDULE_CATCH_UP_AFTER_MS,
  SCHEDULE_RUNS_SHOWN,
  type ScheduleDetailDTO,
  type ScheduleDTO,
  ScheduleEvent,
  type ScheduleRunDTO,
  ScheduleRunOutcome,
  ScheduleRunTrigger,
  ScheduleStatus,
  ServerEventType,
  scheduleMachine,
  TASK_TITLE_MAX_CHARS,
  type TaskSummaryDTO,
  taskMachine,
  transition,
  type UpdateScheduleRequest,
  type WorkflowDTO,
  WorkflowPlanning,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { Logger } from '../../core/logger.ts';
import type { InboxService } from '../inbox/index.ts';
import type { TasksService } from '../tasks/index.ts';
import type { WorkflowsService } from '../workflows/index.ts';
import { foldDueTimes, nextRunAfter } from './schedules.next.ts';
import { createSchedulesRepo, type Schedule, type ScheduleRun } from './schedules.repo.ts';

export type SchedulesServiceDeps = {
  db: Db;
  unit: UnitOfWork;
  clock: Clock;
  log: Logger;
  /** IANA zone the schedules' times of day are read in (22 §2). */
  timeZone: string;
  workflows: WorkflowsService;
  tasks: TasksService;
  inbox: InboxService;
};

const firstLine = (text: string) => text.trim().split('\n')[0]?.trim() ?? '';

/** What a run stands for: why it happens and which scheduled time (22 §4). */
type RunOccasion = { trigger: ScheduleRunTrigger; dueAt: number; missed: number };

/**
 * Scheduled tasks (22): a fixed workflow started as an ordinary task whenever its schedule comes due while the app is
 * open. A schedule only starts tasks; what they produce reaches the user through the tasks' own inbox items (D92).
 */
export function createSchedulesService({
  db,
  unit,
  clock,
  log,
  timeZone,
  workflows,
  tasks,
  inbox,
}: SchedulesServiceDeps) {
  const repo = createSchedulesRepo(db);

  function get(id: string): Schedule {
    const schedule = repo.find(id);
    if (schedule === undefined) throw new AppError(ErrorCode.ScheduleNotFound, `Schedule ${id} not found`, { id });
    return schedule;
  }

  const publish = (scheduleId: string) => unit.publish({ type: ServerEventType.ScheduleUpdated, data: { scheduleId } });

  /** The latest version of a fixed workflow; AI-planned ones cannot run unattended (22 §1, D92). */
  function fixedWorkflow(key: string): WorkflowDTO {
    const workflow = workflows.latest(key);
    if (workflow.planning !== WorkflowPlanning.Fixed) {
      throw new AppError(ErrorCode.ValidationFailed, 'Only fixed workflows can run on a schedule', {
        issues: [{ path: ['workflowKey'], message: `workflow ${key} is planned by AI` }],
      });
    }
    return workflow;
  }

  /** Summaries of the runs' tasks, by id; a run keeps its task until the task is deleted with its project. */
  function taskSummaries(runs: readonly ScheduleRun[]): Map<string, TaskSummaryDTO> {
    const ids = [...new Set(runs.flatMap((run) => (run.taskId === null ? [] : [run.taskId])))];
    return new Map(tasks.summariesOf(ids).map((task) => [task.id, task]));
  }

  const toRunDto = (run: ScheduleRun, byTask: Map<string, TaskSummaryDTO>): ScheduleRunDTO => ({
    id: run.id,
    trigger: run.trigger,
    outcome: run.outcome,
    dueAt: run.dueAt,
    missed: run.missed,
    createdAt: run.createdAt,
    task: run.taskId === null ? null : (byTask.get(run.taskId) ?? null),
    error: run.error,
  });

  /** DTOs of the schedules with their latest and active runs: one query each for runs, tasks and workflow names. */
  function toDtos(schedules: readonly Schedule[]): ScheduleDTO[] {
    const ids = schedules.map((s) => s.id);
    const lastRuns = new Map(repo.lastRuns(ids).map((run) => [run.scheduleId, run]));
    const started = new Map(repo.lastStartedRuns(ids).map((run) => [run.scheduleId, run]));
    const byTask = taskSummaries([...lastRuns.values(), ...started.values()]);
    const names = new Map(workflows.list().map((w) => [w.key, w.name]));
    return schedules.map((schedule) => {
      const lastRun = lastRuns.get(schedule.id);
      const startedTaskId = started.get(schedule.id)?.taskId;
      const activeTask = startedTaskId === undefined || startedTaskId === null ? undefined : byTask.get(startedTaskId);
      return {
        id: schedule.id,
        title: schedule.title,
        requirement: schedule.requirement,
        project: { id: schedule.projectId, name: schedule.projectName },
        workflow: { key: schedule.workflowKey, name: names.get(schedule.workflowKey) ?? null },
        baseBranch: schedule.baseBranch,
        frequency: schedule.frequency,
        status: schedule.status,
        nextRunAt: schedule.nextRunAt,
        activeTask: activeTask === undefined || isTerminalState(taskMachine, activeTask.status) ? null : activeTask,
        lastRun: lastRun === undefined ? null : toRunDto(lastRun, byTask),
        createdAt: schedule.createdAt,
        updatedAt: schedule.updatedAt,
      };
    });
  }

  function detail(id: string): ScheduleDetailDTO {
    const schedule = get(id);
    const runs = repo.runs(id, SCHEDULE_RUNS_SHOWN);
    const byTask = taskSummaries(runs);
    const [dto] = toDtos([schedule]);
    if (dto === undefined) throw new Error(`No DTO for schedule ${id}`);
    return { ...dto, runs: runs.map((run) => toRunDto(run, byTask)) };
  }

  /** The task the schedule's latest started run made, while it has not ended: the next run waits for it (D91). */
  const activeTask = (id: string): TaskSummaryDTO | null => {
    const [dto] = toDtos([get(id)]);
    return dto?.activeTask ?? null;
  };

  /** One task at a time per schedule (D91, 22 §7). */
  const assertIdle = (id: string): void => {
    const running = activeTask(id);
    if (running !== null) {
      throw new AppError(ErrorCode.ScheduleBusy, `Task ${running.key} of schedule ${id} has not ended`, {
        taskId: running.id,
      });
    }
  };

  /** A due run that found the previous task still going is recorded and does nothing else. */
  function skipRun(schedule: Schedule, occasion: RunOccasion): void {
    unit.transact(() => {
      repo.insertRun(newRun(schedule.id, occasion, ScheduleRunOutcome.Skipped));
      publish(schedule.id);
    });
    log.info({ scheduleId: schedule.id }, 'scheduled run skipped, previous task not ended');
  }

  const newRun = (scheduleId: string, occasion: RunOccasion, outcome: ScheduleRunOutcome): ScheduleRun => ({
    id: randomUUID(),
    scheduleId,
    ...occasion,
    outcome,
    taskId: null,
    error: null,
    createdAt: clock.now(),
  });

  /**
   * Starts the run's task like `tasks.create` does, without plan confirmation (22 §1); throws when it cannot. Whether
   * the schedule is idle is checked again where the task is created: two starts may both have passed the earlier
   * check while `checkCreate` ran.
   */
  async function startTask(schedule: Schedule, occasion: RunOccasion): Promise<string> {
    const workflow = fixedWorkflow(schedule.workflowKey);
    const baseBranch = await tasks.checkCreate({
      projectId: schedule.projectId,
      workflowId: workflow.id,
      ...(schedule.baseBranch === null ? {} : { baseBranch: schedule.baseBranch }),
    });
    const taskId = unit.transact(() => {
      assertIdle(schedule.id);
      const id = tasks.insertDraft({
        projectId: schedule.projectId,
        workflowId: workflow.id,
        requirement: schedule.requirement,
        baseBranch,
        checkpoints: { confirm_plan: false },
      });
      repo.insertRun({ ...newRun(schedule.id, occasion, ScheduleRunOutcome.Started), taskId: id });
      publish(schedule.id);
      return id;
    });
    log.info({ scheduleId: schedule.id, taskId, trigger: occasion.trigger }, 'scheduled task started');
    tasks.start(taskId);
    return taskId;
  }

  /** A due run that could not start its task pauses the schedule and asks the user to look (22 §5, D91). */
  function failRun(schedule: Schedule, occasion: RunOccasion, error: AppError): void {
    unit.transact(() => {
      repo.insertRun({ ...newRun(schedule.id, occasion, ScheduleRunOutcome.Failed), error: error.toInfo() });
      const to = transition(scheduleMachine, schedule.status, ScheduleEvent.StartFailed);
      repo.updateStatus(schedule.id, schedule.status, to, { nextRunAt: null, updatedAt: clock.now() });
      inbox.create({
        kind: InboxKind.ScheduleFailure,
        taskId: null,
        nodeId: null,
        attemptId: null,
        title: schedule.title,
        payload: { scheduleId: schedule.id, error: error.toInfo() },
      });
      publish(schedule.id);
    });
    log.warn({ scheduleId: schedule.id, code: error.code }, 'scheduled run failed to start, schedule paused');
  }

  /** Handles one due schedule once, however many of its times passed (22 §4). */
  async function runDue(schedule: Schedule, now: number): Promise<void> {
    if (schedule.nextRunAt === null) throw new Error(`Active schedule ${schedule.id} has no next run`);
    const { dueAt, missed } = foldDueTimes(schedule.frequency, schedule.nextRunAt, now, timeZone);
    const late = missed > 0 || now - dueAt > SCHEDULE_CATCH_UP_AFTER_MS;
    const occasion = { trigger: late ? ScheduleRunTrigger.CatchUp : ScheduleRunTrigger.OnTime, dueAt, missed };
    // Moved on first: whatever this run does, the schedule is not due again until its next time.
    repo.update(schedule.id, { nextRunAt: nextRunAfter(schedule.frequency, now, timeZone), updatedAt: now });
    if (activeTask(schedule.id) !== null) {
      skipRun(schedule, occasion);
      return;
    }
    try {
      await startTask(schedule, occasion);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      // A manual run started meanwhile: like any run that finds a task going, this one is skipped.
      if (err.code === ErrorCode.ScheduleBusy) skipRun(schedule, occasion);
      // Otherwise a failed run: the schedule pauses and the user gets an inbox item (22 §5).
      else failRun(get(schedule.id), occasion, err);
    }
  }

  /** Closes the schedule's open「没能开始」items. */
  function closeFailures(id: string, close: (itemId: string) => void): void {
    for (const item of inbox.listOpen({ kind: InboxKind.ScheduleFailure })) {
      if (item.kind === InboxKind.ScheduleFailure && item.payload.scheduleId === id) close(item.id);
    }
  }

  function changeStatus(id: string, event: ScheduleEvent): ScheduleDetailDTO {
    const schedule = get(id);
    const to = transition(scheduleMachine, schedule.status, event);
    const now = clock.now();
    unit.transact(() => {
      repo.updateStatus(id, schedule.status, to, {
        // Resuming starts from now: times passed while paused are not run (22 §3).
        nextRunAt: to === ScheduleStatus.Active ? nextRunAfter(schedule.frequency, now, timeZone) : null,
        updatedAt: now,
      });
      if (to === ScheduleStatus.Active) {
        closeFailures(id, (itemId) => inbox.resolve(inbox.get(itemId), { resumed: true }));
      }
      publish(id);
    });
    log.info({ scheduleId: id, to }, 'schedule status changed');
    return detail(id);
  }

  return {
    detail,
    list: ({ projectId }: ListSchedulesQuery): ScheduleDTO[] => toDtos(repo.list(projectId)),
    /** When the earliest active schedule is next due, for the timer. */
    nextDue: () => repo.nextDue(),

    async create(input: CreateScheduleRequest): Promise<ScheduleDetailDTO> {
      const workflow = fixedWorkflow(input.workflowKey);
      await tasks.checkCreate({ ...input, workflowId: workflow.id });
      const id = randomUUID();
      const now = clock.now();
      unit.transact(() => {
        repo.insert({
          id,
          projectId: input.projectId,
          workflowKey: workflow.key,
          title: firstLine(input.requirement).slice(0, TASK_TITLE_MAX_CHARS),
          requirement: input.requirement,
          baseBranch: input.baseBranch ?? null,
          frequency: input.frequency,
          status: ScheduleStatus.Active,
          nextRunAt: nextRunAfter(input.frequency, now, timeZone),
          createdAt: now,
          updatedAt: now,
        });
        publish(id);
      });
      log.info({ scheduleId: id, workflow: workflow.key, frequency: input.frequency.kind }, 'schedule created');
      return detail(id);
    },

    async update({ id, ...changes }: UpdateScheduleRequest): Promise<ScheduleDetailDTO> {
      const schedule = get(id);
      const workflow = fixedWorkflow(changes.workflowKey ?? schedule.workflowKey);
      const baseBranch = changes.baseBranch === undefined ? schedule.baseBranch : changes.baseBranch;
      await tasks.checkCreate({
        projectId: schedule.projectId,
        workflowId: workflow.id,
        ...(baseBranch === null ? {} : { baseBranch }),
      });
      const now = clock.now();
      const frequency = changes.frequency ?? schedule.frequency;
      unit.transact(() => {
        repo.update(id, {
          workflowKey: workflow.key,
          baseBranch,
          frequency,
          ...(changes.requirement === undefined
            ? {}
            : {
                requirement: changes.requirement,
                title: firstLine(changes.requirement).slice(0, TASK_TITLE_MAX_CHARS),
              }),
          ...(changes.frequency !== undefined && schedule.status === ScheduleStatus.Active
            ? { nextRunAt: nextRunAfter(frequency, now, timeZone) }
            : {}),
          updatedAt: now,
        });
        publish(id);
      });
      log.info({ scheduleId: id }, 'schedule updated');
      return detail(id);
    },

    pause: (id: string) => changeStatus(id, ScheduleEvent.Pause),
    resume: (id: string) => changeStatus(id, ScheduleEvent.Resume),

    /** 「立即运行一次」(22 §7): its schedule stays; a failure is the caller's error, the schedule does not pause. */
    async run(id: string): Promise<ScheduleDetailDTO> {
      const schedule = get(id);
      assertIdle(id);
      const now = clock.now();
      await startTask(schedule, { trigger: ScheduleRunTrigger.Manual, dueAt: now, missed: 0 });
      return detail(id);
    },

    /** The schedule and its runs go; the tasks it started stay (22 §9). */
    delete(id: string): void {
      get(id);
      unit.transact(() => {
        closeFailures(id, (itemId) => inbox.dismiss(itemId));
        repo.delete(id);
        publish(id);
      });
      log.info({ scheduleId: id }, 'schedule deleted');
    },

    /** One check of the timer: every due active schedule runs once (22 §4). */
    async runDue(): Promise<void> {
      const now = clock.now();
      for (const schedule of repo.due(now)) await runDue(schedule, now);
    },
  };
}
export type SchedulesService = ReturnType<typeof createSchedulesService>;
