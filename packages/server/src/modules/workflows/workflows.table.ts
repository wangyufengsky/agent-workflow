import type { WorkflowDeliverable, WorkflowKind, WorkflowPlanning } from '@aw/shared';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** 10 §workflows: one row per version, never changed after insert except `is_latest`. */
export const workflowsTable = sqliteTable(
  'workflows',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    version: integer('version').notNull(),
    isLatest: integer('is_latest', { mode: 'boolean' }).notNull(),
    kind: text('kind').$type<WorkflowKind>().notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    planning: text('planning').$type<WorkflowPlanning>().notNull(),
    deliverable: text('deliverable').$type<WorkflowDeliverable>().notNull(),
    /** JSON `WorkflowDefinition`. */
    definition: text('definition').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('workflows_key_version_unique').on(t.key, t.version)],
);
