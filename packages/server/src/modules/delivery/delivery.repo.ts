import {
  AppError,
  type DeliveryDTO,
  type DeliveryStatus,
  ErrorCode,
  type ErrorInfo,
  errorInfoSchema,
} from '@aw/shared';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DbExecutor } from '../../core/db/database.ts';
import { deliveriesTable } from './delivery.table.ts';

type DeliveryRow = typeof deliveriesTable.$inferSelect;

export type Delivery = DeliveryDTO & { taskId: string };

/** Columns a transition may change together with the status. */
export type DeliveryChanges = {
  commitSha?: string;
  prUrl?: string;
  conflictFiles?: string[];
  error?: ErrorInfo;
  finishedAt: number;
};

const filesSchema = z.array(z.string());

// JSON columns: parsed at the boundary (06 §9).
function toDelivery(row: DeliveryRow): Delivery {
  return {
    ...row,
    conflictFiles: row.conflictFiles === null ? null : filesSchema.parse(JSON.parse(row.conflictFiles)),
    error: row.error === null ? null : errorInfoSchema.parse(JSON.parse(row.error)),
  };
}

export function createDeliveriesRepo(db: DbExecutor) {
  const t = deliveriesTable;
  return {
    insert(delivery: Pick<DeliveryRow, 'id' | 'taskId' | 'strategy' | 'targetBranch' | 'status' | 'createdAt'>): void {
      db.insert(t).values(delivery).run();
    },
    find(id: string): Delivery | undefined {
      const row = db.select().from(t).where(eq(t.id, id)).get();
      return row === undefined ? undefined : toDelivery(row);
    },
    latest(taskId: string): Delivery | undefined {
      const row = db.select().from(t).where(eq(t.taskId, taskId)).orderBy(desc(t.createdAt), desc(t.id)).get();
      return row === undefined ? undefined : toDelivery(row);
    },
    listByStatus(status: DeliveryStatus): Delivery[] {
      return db.select().from(t).where(eq(t.status, status)).all().map(toDelivery);
    },
    /** The only status write (09 §1): guarded by the expected current status. */
    updateStatus(id: string, from: DeliveryStatus, to: DeliveryStatus, changes: DeliveryChanges): void {
      const { conflictFiles, error, ...rest } = changes;
      const result = db
        .update(t)
        .set({
          status: to,
          ...rest,
          ...(conflictFiles === undefined ? {} : { conflictFiles: JSON.stringify(conflictFiles) }),
          ...(error === undefined ? {} : { error: JSON.stringify(error) }),
        })
        .where(and(eq(t.id, id), eq(t.status, from)))
        .run();
      if (result.changes === 0) {
        throw new AppError(ErrorCode.StateTransitionInvalid, `delivery ${id} is no longer ${from}`, {
          entity: 'delivery',
          from,
          to,
        });
      }
    },
  };
}
