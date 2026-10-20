import { AppError, AttemptKind, type AttemptStatus, ErrorCode, type ErrorInfo, errorInfoSchema } from '@aw/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../core/db/database.ts';
import { attemptsTable } from './attempts.table.ts';

type AttemptRow = typeof attemptsTable.$inferSelect;

/** An attempt as stored; the service adds in-memory state (progress) for DTOs. */
export type Attempt = Omit<AttemptRow, 'error'> & { error: ErrorInfo | null };

export type NewAttempt = Omit<AttemptRow, 'error' | 'tokensInput' | 'tokensOutput' | 'cost' | 'endedAt'>;

function toAttempt({ error, ...row }: AttemptRow): Attempt {
  // JSON column: parsed at the boundary (06 §9).
  return { ...row, error: error === null ? null : errorInfoSchema.parse(JSON.parse(error)) };
}

export function createAttemptsRepo(db: DbExecutor) {
  const byId = (id: string) => eq(attemptsTable.id, id);

  return {
    insert(attempt: NewAttempt): void {
      db.insert(attemptsTable).values(attempt).run();
    },
    find(id: string): Attempt | undefined {
      const row = db.select().from(attemptsTable).where(byId(id)).get();
      return row === undefined ? undefined : toAttempt(row);
    },
    /** The most recent attempt on an opencode session (several when re-planning continues a session). */
    findLatestBySession(sessionId: string): Attempt | undefined {
      const row = db
        .select()
        .from(attemptsTable)
        .where(eq(attemptsTable.opencodeSessionId, sessionId))
        // Insertion order breaks ties: a re-planning attempt may start in the same millisecond.
        .orderBy(desc(attemptsTable.startedAt), desc(sql`rowid`))
        .get();
      return row === undefined ? undefined : toAttempt(row);
    },
    listByStatus(statuses: readonly AttemptStatus[]): Attempt[] {
      return db.select().from(attemptsTable).where(inArray(attemptsTable.status, statuses)).all().map(toAttempt);
    },
    /** Oldest first. */
    listByNode(nodeId: string): Attempt[] {
      return db
        .select()
        .from(attemptsTable)
        .where(eq(attemptsTable.nodeId, nodeId))
        .orderBy(asc(attemptsTable.startedAt), asc(sql`rowid`))
        .all()
        .map(toAttempt);
    },
    /** Attempts of a task in the given states (all kinds), oldest first. */
    listByTask(taskId: string, statuses: readonly AttemptStatus[]): Attempt[] {
      return db
        .select()
        .from(attemptsTable)
        .where(and(eq(attemptsTable.taskId, taskId), inArray(attemptsTable.status, statuses)))
        .orderBy(asc(attemptsTable.startedAt), asc(sql`rowid`))
        .all()
        .map(toAttempt);
    },
    /** The task's most recent plan attempt. */
    findLatestPlan(taskId: string): Attempt | undefined {
      const row = db
        .select()
        .from(attemptsTable)
        .where(and(eq(attemptsTable.taskId, taskId), eq(attemptsTable.kind, AttemptKind.Plan)))
        .orderBy(desc(attemptsTable.startedAt), desc(sql`rowid`))
        .get();
      return row === undefined ? undefined : toAttempt(row);
    },
    /** Next number within the attempt's scope: its node, its task's plan attempts, or the debug attempts. */
    nextSeq(scope: { taskId: string | null; nodeId: string | null; kind: AttemptKind }): number {
      const where =
        scope.nodeId !== null
          ? eq(attemptsTable.nodeId, scope.nodeId)
          : scope.taskId !== null
            ? and(eq(attemptsTable.taskId, scope.taskId), eq(attemptsTable.kind, scope.kind))
            : isNull(attemptsTable.taskId);
      const row = db
        .select({ max: sql<number | null>`max(${attemptsTable.seq})` })
        .from(attemptsTable)
        .where(where)
        .get();
      return (row?.max ?? 0) + 1;
    },
    /** The only status write (09 §1): guarded by the expected current status. */
    updateStatus(
      id: string,
      from: AttemptStatus,
      to: AttemptStatus,
      changes: { endedAt?: number; error?: ErrorInfo } = {},
    ): void {
      const result = db
        .update(attemptsTable)
        .set({
          status: to,
          ...(changes.endedAt === undefined ? {} : { endedAt: changes.endedAt }),
          ...(changes.error === undefined ? {} : { error: JSON.stringify(changes.error) }),
        })
        .where(and(byId(id), eq(attemptsTable.status, from)))
        .run();
      if (result.changes === 0) {
        throw new AppError(ErrorCode.StateTransitionInvalid, `attempt ${id} is no longer ${from}`, {
          entity: 'attempt',
          from,
          to,
        });
      }
    },
    setSession(id: string, sessionId: string): void {
      db.update(attemptsTable).set({ opencodeSessionId: sessionId }).where(byId(id)).run();
    },
    incrementNudges(id: string): void {
      db.update(attemptsTable)
        .set({ nudges: sql`${attemptsTable.nudges} + 1` })
        .where(byId(id))
        .run();
    },
    addUsage(id: string, usage: { input: number; output: number; cost: number }): void {
      db.update(attemptsTable)
        .set({
          tokensInput: sql`coalesce(${attemptsTable.tokensInput}, 0) + ${usage.input}`,
          tokensOutput: sql`coalesce(${attemptsTable.tokensOutput}, 0) + ${usage.output}`,
          cost: sql`coalesce(${attemptsTable.cost}, 0) + ${usage.cost}`,
        })
        .where(byId(id))
        .run();
    },
  };
}
export type AttemptsRepo = ReturnType<typeof createAttemptsRepo>;
