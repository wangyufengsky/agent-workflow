import type { PlanSource, PlanStatus } from '@aw/shared';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { tasksTable } from '../tasks/tasks.table.ts';

/** 10 §plans. */
export const plansTable = sqliteTable(
  'plans',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasksTable.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: text('status').$type<PlanStatus>().notNull(),
    source: text('source').$type<PlanSource>().notNull(),
    /** JSON `PlanGraph`. */
    graph: text('graph').notNull(),
    summary: text('summary'),
    /** JSON `string[]`. */
    assumptions: text('assumptions').notNull(),
    feedback: text('feedback'),
    // No foreign key: attempts reference nodes, which reference plans.
    createdByAttemptId: text('created_by_attempt_id'),
    createdAt: integer('created_at').notNull(),
    confirmedAt: integer('confirmed_at'),
  },
  (t) => [uniqueIndex('plans_task_version_unique').on(t.taskId, t.version)],
);
