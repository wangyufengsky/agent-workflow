import type { InboxKind, InboxStatus } from '@aw/shared';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { attemptsTable } from '../attempts/attempts.table.ts';
import { nodesTable } from '../nodes/nodes.table.ts';
import { tasksTable } from '../tasks/tasks.table.ts';

/** 10 §inbox_items:「需要你处理」. */
export const inboxItemsTable = sqliteTable(
  'inbox_items',
  {
    id: text('id').primaryKey(),
    kind: text('kind').$type<InboxKind>().notNull(),
    status: text('status').$type<InboxStatus>().notNull(),
    taskId: text('task_id').references(() => tasksTable.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').references(() => nodesTable.id, { onDelete: 'cascade' }),
    attemptId: text('attempt_id').references(() => attemptsTable.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** JSON, by kind. */
    payload: text('payload').notNull(),
    /** JSON, by kind. */
    response: text('response'),
    createdAt: integer('created_at').notNull(),
    resolvedAt: integer('resolved_at'),
  },
  (t) => [index('inbox_status_created_idx').on(t.status, t.createdAt), index('inbox_task_idx').on(t.taskId)],
);
