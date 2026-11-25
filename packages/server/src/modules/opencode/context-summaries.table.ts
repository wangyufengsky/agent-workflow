import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { tasksTable } from '../tasks/tasks.table.ts';

export const contextSummaries = sqliteTable('context_summaries', {
  sessionId: text('session_id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasksTable.id, { onDelete: 'cascade' }),
  uptoMessageId: text('upto_message_id').notNull(),
  summaryText: text('summary_text').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
