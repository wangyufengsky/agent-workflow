import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { assistantConversationsTable } from '../assistant/assistant.table.ts';
import { projectsTable } from '../projects/projects.table.ts';
import { tasksTable } from '../tasks/tasks.table.ts';

export const bashGrantsTable = sqliteTable('bash_grants', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').references(() => assistantConversationsTable.id, { onDelete: 'cascade' }),
  taskId: text('task_id').references(() => tasksTable.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => projectsTable.id, { onDelete: 'cascade' }),
  directory: text('directory').notNull(),
  command: text('command').notNull(),
  fingerprint: text('fingerprint').notNull(),
});
