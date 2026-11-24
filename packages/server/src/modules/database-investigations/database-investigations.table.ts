import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { assistantConversationsTable } from '../assistant/assistant.table.ts';
import { dbConnectionsTable } from '../databases/databases.table.ts';
import { projectsTable } from '../projects/projects.table.ts';
import { tasksTable } from '../tasks/tasks.table.ts';

export const databaseInvestigationsTable = sqliteTable(
  'database_investigations',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projectsTable.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id')
      .notNull()
      .references(() => dbConnectionsTable.id, { onDelete: 'cascade' }),
    taskId: text('task_id').references(() => tasksTable.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id').references(() => assistantConversationsTable.id, { onDelete: 'cascade' }),
    grantFingerprint: text('grant_fingerprint').notNull(),
    result: text('result').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    check('database_investigation_owner', sql`(${t.taskId} IS NULL) != (${t.conversationId} IS NULL)`),
    index('database_investigations_task_idx').on(t.taskId, t.updatedAt),
    index('database_investigations_conversation_idx').on(t.conversationId, t.updatedAt),
  ],
);

/** 会话清理可跨越主调查行的外键级联删除，运行时未连接时保留待重试记录。 */
export const databaseInvestigationSessionsTable = sqliteTable('database_investigation_sessions', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
});
