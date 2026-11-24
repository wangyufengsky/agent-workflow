import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { credentialsTable } from '../credentials/credentials.table.ts';

function keyValueTable<T extends string>(name: T) {
  return sqliteTable(
    name,
    {
      key: text('key').primaryKey(),
      name: text('name').notNull(),
      value: text('value'),
      credentialId: text('credential_id').references(() => credentialsTable.id),
      position: integer('position').notNull(),
    },
    (table) => [check(`${name}_single_value`, sql`(${table.value} IS NULL) != (${table.credentialId} IS NULL)`)],
  );
}
export const startupEnvironmentTable = keyValueTable('startup_environment');
export const opencodeHeadersTable = keyValueTable('opencode_headers');
