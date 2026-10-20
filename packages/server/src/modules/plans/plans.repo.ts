import { AppError, ErrorCode, type PlanDTO, type PlanStatus, planGraphSchema } from '@aw/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbExecutor } from '../../core/db/database.ts';
import { plansTable } from './plans.table.ts';

type PlanRow = typeof plansTable.$inferSelect;
/** A plan with the task it belongs to, as the service handles it. */
export type Plan = PlanDTO & { taskId: string };

const assumptionsSchema = z.array(z.string());

function toPlan({ graph, assumptions, createdByAttemptId: _attempt, ...row }: PlanRow): Plan {
  return {
    ...row,
    graph: planGraphSchema.parse(JSON.parse(graph)),
    assumptions: assumptionsSchema.parse(JSON.parse(assumptions)),
  };
}

export function createPlansRepo(db: DbExecutor) {
  const t = plansTable;
  return {
    insert(plan: Plan & { createdByAttemptId: string | null }): void {
      db.insert(t)
        .values({ ...plan, graph: JSON.stringify(plan.graph), assumptions: JSON.stringify(plan.assumptions) })
        .run();
    },
    find(id: string): Plan | undefined {
      const row = db.select().from(t).where(eq(t.id, id)).get();
      return row === undefined ? undefined : toPlan(row);
    },
    findByVersion(taskId: string, version: number): Plan | undefined {
      const row = db
        .select()
        .from(t)
        .where(and(eq(t.taskId, taskId), eq(t.version, version)))
        .get();
      return row === undefined ? undefined : toPlan(row);
    },
    findByStatus(taskId: string, status: PlanStatus): Plan | undefined {
      const row = db
        .select()
        .from(t)
        .where(and(eq(t.taskId, taskId), eq(t.status, status)))
        .get();
      return row === undefined ? undefined : toPlan(row);
    },
    /** Newest first. */
    listByTask(taskId: string): Plan[] {
      return db.select().from(t).where(eq(t.taskId, taskId)).orderBy(desc(t.version)).all().map(toPlan);
    },
    nextVersion(taskId: string): number {
      const row = db
        .select({ max: sql<number | null>`max(${t.version})` })
        .from(t)
        .where(eq(t.taskId, taskId))
        .get();
      return (row?.max ?? 0) + 1;
    },
    /** The only status write (09 §1): guarded by the expected current status. */
    updateStatus(id: string, from: PlanStatus, to: PlanStatus, changes: { confirmedAt?: number } = {}): void {
      const result = db
        .update(t)
        .set({ status: to, ...changes })
        .where(and(eq(t.id, id), eq(t.status, from)))
        .run();
      if (result.changes === 0) {
        throw new AppError(ErrorCode.StateTransitionInvalid, `plan ${id} is no longer ${from}`, {
          entity: 'plan',
          from,
          to,
        });
      }
    },
  };
}
