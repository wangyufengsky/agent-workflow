import type { CredentialKind } from '@aw/shared';
import { blob, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const credentialsTable = sqliteTable('credentials', {
  id: text('id').primaryKey(),
  kind: text('kind').$type<CredentialKind>().notNull(),
  /** safeStorage output; never logged, never in a DTO. */
  ciphertext: blob('ciphertext', { mode: 'buffer' }).notNull(),
  createdAt: integer('created_at').notNull(),
});
