import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { assistantConversationsTable } from './assistant.table.ts';

export const assistantBrowserActivityTable = sqliteTable(
  'assistant_browser_activity',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => assistantConversationsTable.id, { onDelete: 'cascade' }),
    record: text('record').notNull(),
    at: integer('at').notNull(),
  },
  (table) => [index('assistant_browser_activity_conversation_idx').on(table.conversationId, table.id)],
);
