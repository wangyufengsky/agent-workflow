import type { WorktreeStatus } from '@aw/shared';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { projectsTable } from '../projects/projects.table.ts';
import { tasksTable } from '../tasks/tasks.table.ts';

/** 10 §worktrees: one per task. */
export const worktreesTable = sqliteTable('worktrees', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projectsTable.id),
  taskId: text('task_id')
    .notNull()
    .unique()
    .references(() => tasksTable.id, { onDelete: 'cascade' }),
  path: text('path').notNull().unique(),
  branch: text('branch').notNull(),
  baseCommit: text('base_commit').notNull(),
  status: text('status').$type<WorktreeStatus>().notNull(),
  error: text('error'),
  createdAt: integer('created_at').notNull(),
  removedAt: integer('removed_at'),
});
