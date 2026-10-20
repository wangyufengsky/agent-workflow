import type { NodeKind, NodeStatus } from '@aw/shared';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { plansTable } from '../plans/plans.table.ts';
import { rolesTable } from '../roles/roles.table.ts';
import { tasksTable } from '../tasks/tasks.table.ts';

/** 10 §nodes: materialized from the confirmed plan. */
export const nodesTable = sqliteTable(
  'nodes',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasksTable.id, { onDelete: 'cascade' }),
    /** The plan version that last defined the node. */
    planId: text('plan_id')
      .notNull()
      .references(() => plansTable.id),
    key: text('key').notNull(),
    title: text('title').notNull(),
    roleId: text('role_id')
      .notNull()
      .references(() => rolesTable.id),
    instructions: text('instructions').notNull(),
    /** JSON node keys. */
    dependsOn: text('depends_on').notNull(),
    /** JSON `Acceptance`, `$PROJECT_CHECK` already replaced. */
    acceptance: text('acceptance').notNull(),
    kind: text('kind').$type<NodeKind>().notNull(),
    status: text('status').$type<NodeStatus>().notNull(),
    /** Execute attempts that used the budget (09 §3). */
    attemptCount: integer('attempt_count').notNull(),
    retryFeedback: text('retry_feedback'),
    /** JSON `NodeResult`. */
    result: text('result'),
    /** JSON `CheckResult[]`. */
    checkResults: text('check_results'),
    commitSha: text('commit_sha'),
    position: integer('position').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
  },
  (t) => [
    uniqueIndex('nodes_task_key_unique').on(t.taskId, t.key),
    index('nodes_task_status_idx').on(t.taskId, t.status),
  ],
);
