import type { AttemptKind, AttemptStatus } from '@aw/shared';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { nodesTable } from '../nodes/nodes.table.ts';
import { rolesTable } from '../roles/roles.table.ts';
import { tasksTable } from '../tasks/tasks.table.ts';

/** 10 §attempts. A debug attempt (development builds, M2-09) has no task, node or role. */
export const attemptsTable = sqliteTable(
  'attempts',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').references(() => tasksTable.id, { onDelete: 'cascade' }),
    /** The node an execute attempt works on, or the node a review attempt reviews; null for plan attempts. */
    nodeId: text('node_id').references(() => nodesTable.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<AttemptKind>().notNull(),
    seq: integer('seq').notNull(),
    status: text('status').$type<AttemptStatus>().notNull(),
    roleId: text('role_id').references(() => rolesTable.id),
    model: text('model'),
    /** Working directory of the session (the task worktree). */
    directory: text('directory').notNull(),
    /** Not unique: a re-planning attempt continues the previous planning session (12 §4.3). */
    opencodeSessionId: text('opencode_session_id'),
    nudges: integer('nudges').notNull(),
    /** JSON `ErrorInfo`. */
    error: text('error'),
    tokensInput: integer('tokens_input'),
    tokensOutput: integer('tokens_output'),
    cost: real('cost'),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
  },
  (t) => [
    index('attempts_node_id_idx').on(t.nodeId),
    index('attempts_task_kind_idx').on(t.taskId, t.kind),
    index('attempts_status_idx').on(t.status),
    index('attempts_session_idx').on(t.opencodeSessionId),
  ],
);
