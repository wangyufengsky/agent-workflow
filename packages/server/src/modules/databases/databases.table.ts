import type { DbType } from '@aw/shared';
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { credentialsTable } from '../credentials/credentials.table.ts';
import { projectsTable } from '../projects/projects.table.ts';

/** 10 §db_connections: the password is a credential (06 §11). */
export const dbConnectionsTable = sqliteTable('db_connections', {
  id: text('id').primaryKey(),
  /** Unique: the AI's database tools name a connection by it. */
  name: text('name').notNull().unique(),
  type: text('type').$type<DbType>().notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  database: text('database').notNull(),
  username: text('username').notNull(),
  credentialId: text('credential_id')
    .notNull()
    .references(() => credentialsTable.id),
  tls: integer('tls', { mode: 'boolean' }).notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** 10 §project_db_connections: which connections a project's AI sessions may query. */
export const projectDbConnectionsTable = sqliteTable(
  'project_db_connections',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projectsTable.id, { onDelete: 'cascade' }),
    dbConnectionId: text('db_connection_id')
      .notNull()
      .references(() => dbConnectionsTable.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.dbConnectionId] })],
);
