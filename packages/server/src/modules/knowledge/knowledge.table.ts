import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { attemptsTable } from '../attempts/attempts.table.ts';
import { projectsTable } from '../projects/projects.table.ts';

/** 10 §knowledge_conversations (18 §3): questions about one project, with sources fixed at the start. */
export const knowledgeConversationsTable = sqliteTable(
  'knowledge_conversations',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projectsTable.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** JSON `KnowledgeSources`. */
    sources: text('sources').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('knowledge_conversations_project_idx').on(t.projectId),
    index('knowledge_conversations_updated_idx').on(t.updatedAt),
  ],
);

/** 10 §knowledge_turns: one question and its research attempt; the status is the attempt's. */
export const knowledgeTurnsTable = sqliteTable(
  'knowledge_turns',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => knowledgeConversationsTable.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    question: text('question').notNull(),
    attemptId: text('attempt_id')
      .notNull()
      .references(() => attemptsTable.id),
    /** Markdown with `[n]` markers, once `submit_answer` passed. */
    answer: text('answer'),
    /** JSON `CitationDTO[]`, written with the answer. */
    citations: text('citations'),
    createdAt: integer('created_at').notNull(),
    answeredAt: integer('answered_at'),
  },
  (t) => [
    uniqueIndex('knowledge_turns_conversation_seq_idx').on(t.conversationId, t.seq),
    index('knowledge_turns_attempt_idx').on(t.attemptId),
  ],
);
