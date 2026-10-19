import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const items = sqliteTable('items', {
  id: text('id').primaryKey(),
  n: integer('n').notNull(),
  payload: text('payload', { mode: 'json' }).$type<{ tag: string }>().notNull(),
});
