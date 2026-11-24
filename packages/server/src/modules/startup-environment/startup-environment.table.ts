import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { credentialsTable } from '../credentials/credentials.table.ts';

export const startupEnvironmentTable = sqliteTable(
  'startup_environment',
  {
    key: text('key').primaryKey(),
    name: text('name').notNull(),
    value: text('value'),
    credentialId: text('credential_id').references(() => credentialsTable.id),
    position: integer('position').notNull(),
  },
  (table) => [
    check('startup_environment_single_value', sql`(${table.value} IS NULL) != (${table.credentialId} IS NULL)`),
  ],
);
