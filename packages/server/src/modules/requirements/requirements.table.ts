import type { RequirementConclusion, RequirementResultSource } from '@aw/shared';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { tasksTable } from '../tasks/tasks.table.ts';

/** 10 §6.2 requirement_revisions: a task's acceptance checklist, one immutable row per saved version. */
export const requirementRevisionsTable = sqliteTable(
  'requirement_revisions',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasksTable.id, { onDelete: 'cascade' }),
    /** 1, 2, …; the highest is the current version. */
    seq: integer('seq').notNull(),
    /** JSON `RequirementItem[]`. */
    items: text('items').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('requirement_revisions_task_seq_idx').on(t.taskId, t.seq)],
);

/** 10 §6.2 requirement_results: conclusions on items, appended and never changed. */
export const requirementResultsTable = sqliteTable(
  'requirement_results',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasksTable.id, { onDelete: 'cascade' }),
    revisionId: text('revision_id')
      .notNull()
      .references(() => requirementRevisionsTable.id, { onDelete: 'cascade' }),
    itemId: text('item_id').notNull(),
    source: text('source').$type<RequirementResultSource>().notNull(),
    conclusion: text('conclusion').$type<RequirementConclusion>().notNull(),
    note: text('note').notNull(),
    output: text('output'),
    /** The verify step that gave it; null for the user's. */
    nodeId: text('node_id'),
    /** The task branch's commit the conclusion is about (31 §3). */
    commitSha: text('commit_sha').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('requirement_results_task_idx').on(t.taskId, t.createdAt)],
);
