import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { projectsTable } from '../projects/projects.table.ts';
import { tasksTable } from '../tasks/tasks.table.ts';
import { workflowsTable } from '../workflows/workflows.table.ts';

/** 10 §batches (20 §6): one fixed workflow run on several targets; no status, its tasks' states are its progress. */
export const batchesTable = sqliteTable('batches', {
  id: text('id').primaryKey(),
  /** Shown as `B-<seq>`. */
  seq: integer('seq').notNull().unique(),
  projectId: text('project_id')
    .notNull()
    .references(() => projectsTable.id, { onDelete: 'cascade' }),
  /** The workflow version every task of the batch runs. */
  workflowId: text('workflow_id')
    .notNull()
    .references(() => workflowsTable.id),
  title: text('title').notNull(),
  requirementTemplate: text('requirement_template').notNull(),
  baseBranch: text('base_branch').notNull(),
  createdAt: integer('created_at').notNull(),
});

/** 10 §batch_tasks: the task made for each target, in target order. */
export const batchTasksTable = sqliteTable(
  'batch_tasks',
  {
    batchId: text('batch_id')
      .notNull()
      .references(() => batchesTable.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .unique()
      .references(() => tasksTable.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    target: text('target').notNull(),
  },
  (t) => [primaryKey({ columns: [t.batchId, t.position] })],
);
