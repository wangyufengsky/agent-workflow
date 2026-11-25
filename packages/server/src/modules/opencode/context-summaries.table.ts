import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { assistantConversationsTable } from '../assistant/assistant.table.ts';
import { attemptsTable } from '../attempts/attempts.table.ts';
import { tasksTable } from '../tasks/tasks.table.ts';

export const contextSummaries = sqliteTable('context_summaries', {
  sessionId: text('session_id').primaryKey(),
  taskId: text('task_id').references(() => tasksTable.id, { onDelete: 'cascade' }),
  attemptId: text('attempt_id').references(() => attemptsTable.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').references(() => assistantConversationsTable.id, { onDelete: 'cascade' }),
  uptoMessageId: text('upto_message_id').notNull(),
  summaryText: text('summary_text').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
