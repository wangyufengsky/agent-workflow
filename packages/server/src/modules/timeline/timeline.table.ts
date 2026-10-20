import type { TaskEventEntity } from '@aw/shared';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { tasksTable } from '../tasks/tasks.table.ts';

/** 10 §task_events: append-only timeline of a task's state changes. */
export const taskEventsTable = sqliteTable(
  'task_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    taskId: text('task_id')
      .notNull()
      .references(() => tasksTable.id, { onDelete: 'cascade' }),
    entity: text('entity').$type<TaskEventEntity>().notNull(),
    entityId: text('entity_id').notNull(),
    /** State-machine event name, or `note`. */
    type: text('type').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    /** JSON object. */
    payload: text('payload'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('task_events_task_idx').on(t.taskId, t.id)],
);
