import type { ScheduleRunOutcome, ScheduleRunTrigger, ScheduleStatus } from '@aw/shared';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { projectsTable } from '../projects/projects.table.ts';
import { tasksTable } from '../tasks/tasks.table.ts';

/** 10 §schedules (22 §8): a fixed workflow run on a schedule. */
export const schedulesTable = sqliteTable('schedules', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projectsTable.id, { onDelete: 'cascade' }),
  /** No foreign key: each run uses the key's latest version; a deleted workflow fails the run (22 §5). */
  workflowKey: text('workflow_key').notNull(),
  title: text('title').notNull(),
  requirement: text('requirement').notNull(),
  /** Null: the project's default branch at each run. */
  baseBranch: text('base_branch'),
  /** JSON `ScheduleFrequency`. */
  frequency: text('frequency').notNull(),
  status: text('status').$type<ScheduleStatus>().notNull(),
  /** Null while paused. */
  nextRunAt: integer('next_run_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** 10 §schedule_runs: each time a schedule came due or was run by hand. */
export const scheduleRunsTable = sqliteTable(
  'schedule_runs',
  {
    id: text('id').primaryKey(),
    scheduleId: text('schedule_id')
      .notNull()
      .references(() => schedulesTable.id, { onDelete: 'cascade' }),
    trigger: text('trigger').$type<ScheduleRunTrigger>().notNull(),
    outcome: text('outcome').$type<ScheduleRunOutcome>().notNull(),
    dueAt: integer('due_at').notNull(),
    missed: integer('missed').notNull(),
    taskId: text('task_id').references(() => tasksTable.id, { onDelete: 'set null' }),
    /** JSON `ErrorInfo` of a failed run. */
    error: text('error'),
    createdAt: integer('created_at').notNull(),
  },
  // Runs are read newest first by insertion order (rowid), which every index entry ends with.
  (t) => [index('schedule_runs_schedule_idx').on(t.scheduleId)],
);
