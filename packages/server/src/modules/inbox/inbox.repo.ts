import {
  AppError,
  BLOCKING_INBOX_KINDS,
  ErrorCode,
  type InboxItemDTO,
  type InboxKind,
  InboxStatus,
  inboxItemSchema,
} from '@aw/shared';
import { and, count, desc, eq, inArray, lt, or, type SQL } from 'drizzle-orm';
import type { DbExecutor } from '../../core/db/database.ts';
import { inboxItemsTable } from './inbox.table.ts';

type InboxRow = typeof inboxItemsTable.$inferSelect;

/** Which items a query or an automatic dismissal concerns. */
export type InboxScope = {
  taskId?: string;
  nodeId?: string;
  attemptId?: string;
  kind?: InboxKind;
  kinds?: readonly InboxKind[];
};

function toItem(row: InboxRow): InboxItemDTO {
  // JSON columns: parsed at the boundary with the schema of the item's kind (06 §9).
  return inboxItemSchema.parse({
    ...row,
    payload: JSON.parse(row.payload),
    response: row.response === null ? null : JSON.parse(row.response),
  });
}

function whereOf(scope: InboxScope, status?: InboxStatus): SQL | undefined {
  const t = inboxItemsTable;
  return and(
    ...(status === undefined ? [] : [eq(t.status, status)]),
    ...(scope.taskId === undefined ? [] : [eq(t.taskId, scope.taskId)]),
    ...(scope.nodeId === undefined ? [] : [eq(t.nodeId, scope.nodeId)]),
    ...(scope.attemptId === undefined ? [] : [eq(t.attemptId, scope.attemptId)]),
    ...(scope.kind === undefined ? [] : [eq(t.kind, scope.kind)]),
    ...(scope.kinds === undefined ? [] : [inArray(t.kind, [...scope.kinds])]),
  );
}

export function createInboxRepo(db: DbExecutor) {
  return {
    /** Payload and response must match the kind; reading the row back checks it. */
    insert(item: Omit<InboxRow, 'payload' | 'response'> & { payload: unknown; response: unknown }): void {
      db.insert(inboxItemsTable)
        .values({
          ...item,
          payload: JSON.stringify(item.payload),
          response: item.response === null ? null : JSON.stringify(item.response),
        })
        .run();
    },
    find(id: string): InboxItemDTO | undefined {
      const row = db.select().from(inboxItemsTable).where(eq(inboxItemsTable.id, id)).get();
      return row === undefined ? undefined : toItem(row);
    },
    /** Newest first. */
    list(scope: InboxScope, status?: InboxStatus): InboxItemDTO[] {
      return db
        .select()
        .from(inboxItemsTable)
        .where(whereOf(scope, status))
        .orderBy(desc(inboxItemsTable.createdAt))
        .all()
        .map(toItem);
    },
    /** One page, newest first (11 §1): `after` is where the previous page ended. */
    page(
      scope: InboxScope,
      status: InboxStatus | undefined,
      after: { createdAt: number; id: string } | undefined,
      limit: number,
    ): InboxItemDTO[] {
      const t = inboxItemsTable;
      return db
        .select()
        .from(t)
        .where(
          and(
            whereOf(scope, status),
            ...(after === undefined
              ? []
              : [or(lt(t.createdAt, after.createdAt), and(eq(t.createdAt, after.createdAt), lt(t.id, after.id)))]),
          ),
        )
        .orderBy(desc(t.createdAt), desc(t.id))
        .limit(limit)
        .all()
        .map(toItem);
    },
    /** The badge count (D119): open items that hold something up. */
    countBlocking(): number {
      const row = db
        .select({ n: count() })
        .from(inboxItemsTable)
        .where(whereOf({ kinds: BLOCKING_INBOX_KINDS }, InboxStatus.Open))
        .get();
      return row?.n ?? 0;
    },
    /** The only status write (09 §1): guarded by the expected current status. */
    close(id: string, to: InboxStatus, changes: { response?: unknown; resolvedAt: number }): void {
      const result = db
        .update(inboxItemsTable)
        .set({
          status: to,
          resolvedAt: changes.resolvedAt,
          ...(changes.response === undefined ? {} : { response: JSON.stringify(changes.response) }),
        })
        .where(and(eq(inboxItemsTable.id, id), eq(inboxItemsTable.status, InboxStatus.Open)))
        .run();
      if (result.changes === 0) {
        throw new AppError(ErrorCode.InboxItemClosed, `Inbox item ${id} is already closed`, { id });
      }
    },
  };
}
