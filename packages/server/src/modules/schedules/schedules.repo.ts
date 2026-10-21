import {
  AppError,
  ErrorCode,
  type ErrorInfo,
  errorInfoSchema,
  type ScheduleFrequency,
  ScheduleRunOutcome,
  ScheduleStatus,
  scheduleFrequencySchema,
} from '@aw/shared';
import { and, asc, desc, eq, inArray, isNotNull, lte, min, type SQL, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../core/db/database.ts';
import { projectsTable } from '../projects/index.ts';
import { scheduleRunsTable, schedulesTable } from './schedules.table.ts';

type ScheduleRow = typeof schedulesTable.$inferSelect;
type RunRow = typeof scheduleRunsTable.$inferSelect;

/** A schedule with its frequency parsed and its project's name. */
export type Schedule = Omit<ScheduleRow, 'frequency'> & { frequency: ScheduleFrequency; projectName: string };
export type ScheduleRun = Omit<RunRow, 'error'> & { error: ErrorInfo | null };
export type NewSchedule = Omit<ScheduleRow, 'frequency'> & { frequency: ScheduleFrequency };
export type ScheduleChanges = Partial<
  Pick<NewSchedule, 'workflowKey' | 'title' | 'requirement' | 'baseBranch' | 'frequency' | 'nextRunAt'>
> & { updatedAt: number };

// JSON columns are parsed at the boundary (06 §9).
const toSchedule = ({ schedule, projectName }: { schedule: ScheduleRow; projectName: string }): Schedule => ({
  ...schedule,
  frequency: scheduleFrequencySchema.parse(JSON.parse(schedule.frequency)),
  projectName,
});
const toRun = (row: RunRow): ScheduleRun => ({
  ...row,
  error: row.error === null ? null : errorInfoSchema.parse(JSON.parse(row.error)),
});

export function createSchedulesRepo(db: DbExecutor) {
  const s = schedulesTable;
  const r = scheduleRunsTable;
  const select = (where: SQL | undefined) =>
    db
      .select({ schedule: s, projectName: projectsTable.name })
      .from(s)
      .innerJoin(projectsTable, eq(projectsTable.id, s.projectId))
      .where(where);
  /** The newest run of each schedule among those `where` admits; inserted order breaks ties in the same millisecond. */
  const latestRuns = (scheduleIds: readonly string[], where?: SQL): ScheduleRun[] => {
    const newest = db
      .select({ rowid: sql<number>`max(rowid)`.as('newest') })
      .from(r)
      .where(and(inArray(r.scheduleId, scheduleIds), where))
      .groupBy(r.scheduleId);
    return db.select().from(r).where(inArray(sql`rowid`, newest)).all().map(toRun);
  };

  return {
    insert(schedule: NewSchedule): void {
      db.insert(s)
        .values({ ...schedule, frequency: JSON.stringify(schedule.frequency) })
        .run();
    },
    find(id: string): Schedule | undefined {
      const row = select(eq(s.id, id)).get();
      return row === undefined ? undefined : toSchedule(row);
    },
    /** Newest first. */
    list(projectId: string | undefined): Schedule[] {
      return select(projectId === undefined ? undefined : eq(s.projectId, projectId))
        .orderBy(desc(s.createdAt), desc(sql`${s}.rowid`))
        .all()
        .map(toSchedule);
    },
    update(id: string, changes: ScheduleChanges): void {
      const { frequency, ...rest } = changes;
      db.update(s)
        .set({ ...rest, ...(frequency === undefined ? {} : { frequency: JSON.stringify(frequency) }) })
        .where(eq(s.id, id))
        .run();
    },
    /** The only status write (09 §1): guarded by the expected current status. */
    updateStatus(
      id: string,
      from: ScheduleStatus,
      to: ScheduleStatus,
      changes: { nextRunAt: number | null; updatedAt: number },
    ): void {
      const result = db
        .update(s)
        .set({ status: to, ...changes })
        .where(and(eq(s.id, id), eq(s.status, from)))
        .run();
      if (result.changes === 0) {
        throw new AppError(ErrorCode.StateTransitionInvalid, `schedule ${id} is no longer ${from}`, {
          entity: 'schedule',
          from,
          to,
        });
      }
    },
    delete(id: string): void {
      db.delete(s).where(eq(s.id, id)).run();
    },
    /** Active schedules whose next run is due at `now`, the earliest first. */
    due(now: number): Schedule[] {
      return select(and(eq(s.status, ScheduleStatus.Active), lte(s.nextRunAt, now)))
        .orderBy(asc(s.nextRunAt))
        .all()
        .map(toSchedule);
    },
    /** When the earliest active schedule is next due. */
    nextDue(): number | undefined {
      const row = db
        .select({ at: min(s.nextRunAt) })
        .from(s)
        .where(eq(s.status, ScheduleStatus.Active))
        .get();
      return row?.at ?? undefined;
    },

    insertRun(run: ScheduleRun): void {
      db.insert(r)
        .values({ ...run, error: run.error === null ? null : JSON.stringify(run.error) })
        .run();
    },
    /** A schedule's latest runs, newest first. */
    runs(scheduleId: string, limit: number): ScheduleRun[] {
      return db
        .select()
        .from(r)
        .where(eq(r.scheduleId, scheduleId))
        .orderBy(desc(sql`rowid`))
        .limit(limit)
        .all()
        .map(toRun);
    },
    /** The newest run of each schedule. */
    lastRuns: (scheduleIds: readonly string[]): ScheduleRun[] => latestRuns(scheduleIds),
    /** The newest run of each schedule that started a task still in the database. */
    lastStartedRuns: (scheduleIds: readonly string[]): ScheduleRun[] =>
      latestRuns(scheduleIds, and(eq(r.outcome, ScheduleRunOutcome.Started), isNotNull(r.taskId))),
  };
}
