import type { AttemptKind, AttemptStatus } from '@aw/shared';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * 10 §attempts. `task_id` / `node_id` / `role_id` get their foreign keys with the tasks, nodes and roles tables (M3);
 * a debug attempt (development builds, M2-09) has none of them.
 */
export const attemptsTable = sqliteTable(
  'attempts',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id'),
    nodeId: text('node_id'),
    kind: text('kind').$type<AttemptKind>().notNull(),
    seq: integer('seq').notNull(),
    status: text('status').$type<AttemptStatus>().notNull(),
    roleId: text('role_id'),
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
