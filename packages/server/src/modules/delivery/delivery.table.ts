import type { DeliveryStatus, DeliveryStrategy } from '@aw/shared';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { tasksTable } from '../tasks/tasks.table.ts';

/** 10 §deliveries: one per merge or pull request of a task. */
export const deliveriesTable = sqliteTable(
  'deliveries',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasksTable.id, { onDelete: 'cascade' }),
    strategy: text('strategy').$type<DeliveryStrategy>().notNull(),
    targetBranch: text('target_branch').notNull(),
    status: text('status').$type<DeliveryStatus>().notNull(),
    commitSha: text('commit_sha'),
    prUrl: text('pr_url'),
    /** JSON file paths. */
    conflictFiles: text('conflict_files'),
    /** JSON `ErrorInfo`. */
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [index('deliveries_task_idx').on(t.taskId, t.createdAt)],
);
