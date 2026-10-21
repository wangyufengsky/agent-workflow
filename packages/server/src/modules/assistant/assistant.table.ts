import type { AssistantConfirmationStatus } from '@aw/shared';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** 10 §4 assistant_conversations: one opencode session each, created with the first message. */
export const assistantConversationsTable = sqliteTable(
  'assistant_conversations',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    opencodeSessionId: text('opencode_session_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('assistant_conversations_session_idx').on(t.opencodeSessionId),
    index('assistant_conversations_updated_idx').on(t.updatedAt),
  ],
);

/** 10 §4 assistant_confirmations: a write or critical call waiting for the user (15 §4). */
export const assistantConfirmationsTable = sqliteTable(
  'assistant_confirmations',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => assistantConversationsTable.id, { onDelete: 'cascade' }),
    operationId: text('operation_id').notNull(),
    /** JSON: the input the operation runs with. */
    input: text('input').notNull(),
    status: text('status').$type<AssistantConfirmationStatus>().notNull(),
    /** JSON `AssistantConfirmationResult`, once confirmed. */
    result: text('result'),
    createdAt: integer('created_at').notNull(),
    resolvedAt: integer('resolved_at'),
  },
  (t) => [index('assistant_confirmations_conversation_idx').on(t.conversationId, t.createdAt)],
);
