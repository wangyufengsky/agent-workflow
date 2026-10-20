import { randomUUID } from 'node:crypto';
import {
  AppError,
  ErrorCode,
  type PlanDTO,
  PlanEvent,
  type PlanGraph,
  type PlanSource,
  PlanStatus,
  type PlanSummaryDTO,
  planMachine,
  ServerEventType,
  TaskEventEntity,
  transition,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { Logger } from '../../core/logger.ts';
import { recordTaskEvent } from '../timeline/index.ts';
import { createPlansRepo, type Plan } from './plans.repo.ts';

export type PlansServiceDeps = { db: Db; unit: UnitOfWork; clock: Clock; log: Logger };

export type NewPlan = {
  taskId: string;
  source: PlanSource;
  graph: PlanGraph;
  summary: string | null;
  assumptions: string[];
  /** The user feedback this version answers. */
  feedback: string | null;
  createdByAttemptId: string | null;
};

const toDto = ({ taskId: _taskId, ...plan }: Plan): PlanDTO => plan;
const toSummary = ({ graph: _graph, ...plan }: PlanDTO): PlanSummaryDTO => plan;

/** Plan versions of a task and their state machine (09 §5): at most one draft and one confirmed version at a time. */
export function createPlansService({ db, unit, clock, log }: PlansServiceDeps) {
  const repo = createPlansRepo(db);

  function mustFind(id: string): Plan {
    const plan = repo.find(id);
    if (plan === undefined) throw new AppError(ErrorCode.PlanNotFound, `Plan ${id} not found`, { id });
    return plan;
  }

  function publish(plan: Plan): void {
    unit.publish({ type: ServerEventType.PlanUpdated, data: { taskId: plan.taskId, plan: toSummary(toDto(plan)) } });
  }

  function move(plan: Plan, event: PlanEvent, changes: { confirmedAt?: number } = {}): Plan {
    const to = transition(planMachine, plan.status, event);
    unit.transact(() => {
      repo.updateStatus(plan.id, plan.status, to, changes);
      recordTaskEvent(db, {
        taskId: plan.taskId,
        entity: TaskEventEntity.Plan,
        entityId: plan.id,
        type: event,
        fromStatus: plan.status,
        toStatus: to,
        createdAt: clock.now(),
      });
    });
    const updated = mustFind(plan.id);
    publish(updated);
    return updated;
  }

  return {
    get: (id: string): PlanDTO => toDto(mustFind(id)),
    list: (taskId: string): PlanSummaryDTO[] => repo.listByTask(taskId).map((p) => toSummary(toDto(p))),

    getByVersion(taskId: string, version: number): PlanDTO {
      const plan = repo.findByVersion(taskId, version);
      if (plan === undefined)
        throw new AppError(ErrorCode.PlanNotFound, `Plan version ${version} not found`, { version });
      return toDto(plan);
    },

    draft: (taskId: string): PlanDTO | undefined => {
      const plan = repo.findByStatus(taskId, PlanStatus.Draft);
      return plan === undefined ? undefined : toDto(plan);
    },
    confirmed: (taskId: string): PlanDTO | undefined => {
      const plan = repo.findByStatus(taskId, PlanStatus.Confirmed);
      return plan === undefined ? undefined : toDto(plan);
    },

    /** A new draft version; an older draft is superseded by it (09 §5). */
    createDraft(input: NewPlan): PlanDTO {
      return unit.transact(() => {
        const previous = repo.findByStatus(input.taskId, PlanStatus.Draft);
        if (previous !== undefined) move(previous, PlanEvent.Supersede);
        const id = randomUUID();
        const version = repo.nextVersion(input.taskId);
        repo.insert({ ...input, id, version, status: PlanStatus.Draft, createdAt: clock.now(), confirmedAt: null });
        recordTaskEvent(db, {
          taskId: input.taskId,
          entity: TaskEventEntity.Plan,
          entityId: id,
          type: 'note',
          toStatus: PlanStatus.Draft,
          payload: { version, source: input.source },
          createdAt: clock.now(),
        });
        const plan = mustFind(id);
        log.info({ taskId: input.taskId, version, source: input.source }, 'plan draft created');
        publish(plan);
        return toDto(plan);
      });
    },

    /** The newest version of the task's plan, whatever its status. */
    latest: (taskId: string): PlanDTO | undefined => {
      const [newest] = repo.listByTask(taskId);
      return newest === undefined ? undefined : toDto(newest);
    },
    /** A draft nobody will confirm (a paused task resumed without applying its adjustment). */
    discard(planId: string): void {
      move(mustFind(planId), PlanEvent.Supersede);
    },
    /** Confirms a draft; the previously confirmed version is superseded (09 §5). */
    confirm(planId: string): PlanDTO {
      return unit.transact(() => {
        const plan = mustFind(planId);
        const previous = repo.findByStatus(plan.taskId, PlanStatus.Confirmed);
        if (previous !== undefined) move(previous, PlanEvent.Supersede);
        return toDto(move(plan, PlanEvent.Confirm, { confirmedAt: clock.now() }));
      });
    },
  };
}
export type PlansService = ReturnType<typeof createPlansService>;
