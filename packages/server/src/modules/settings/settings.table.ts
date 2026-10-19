import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const settingsTable = sqliteTable('settings', {
  key: text('key').primaryKey(),
  /** JSON; parsed with the key's schema from shared/constants/settings.ts on read. */
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
