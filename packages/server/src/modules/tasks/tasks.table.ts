import type { TaskFailedPhase, TaskStatus } from '@aw/shared';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { projectsTable } from '../projects/projects.table.ts';
import { workflowsTable } from '../workflows/workflows.table.ts';

/** 10 §tasks. */
export const tasksTable = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    seq: integer('seq').notNull().unique(),
    /** `T-<seq>` */
    key: text('key').notNull().unique(),
    // Deleting a project deletes its (finished) tasks first; the restriction catches anything else.
    projectId: text('project_id')
      .notNull()
      .references(() => projectsTable.id, { onDelete: 'restrict' }),
    /** The workflow version the task runs. */
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflowsTable.id),
    title: text('title').notNull(),
    requirement: text('requirement').notNull(),
    status: text('status').$type<TaskStatus>().notNull(),
    failedPhase: text('failed_phase').$type<TaskFailedPhase>(),
    /** JSON `ErrorInfo`. */
    failure: text('failure'),
    /** JSON `Checkpoints`, resolved at creation. */
    checkpoints: text('checkpoints').notNull(),
    baseBranch: text('base_branch').notNull(),
    baseCommit: text('base_commit'),
    branch: text('branch'),
    /** A merge task's source (27 §3.6): its worktree starts there and the base branch is merged in. */
    mergeSource: text('merge_source'),
    // No foreign key: plans reference their task, and two tables cannot import each other.
    currentPlanId: text('current_plan_id'),
    /** JSON `TaskResultDTO`. */
    result: text('result'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
    /** Hidden from the task list; only finished tasks are archived (42, D218). */
    archivedAt: integer('archived_at'),
  },
  (t) => [
    index('tasks_project_status_idx').on(t.projectId, t.status),
    index('tasks_status_updated_idx').on(t.status, t.updatedAt),
    index('tasks_archived_idx').on(t.archivedAt),
  ],
);

/** 10 §app_counters: numbers handed out once and never again, e.g. `task_seq` for `T-<seq>` (D223). */
export const appCountersTable = sqliteTable('app_counters', {
  name: text('name').primaryKey(),
  value: integer('value').notNull(),
});
