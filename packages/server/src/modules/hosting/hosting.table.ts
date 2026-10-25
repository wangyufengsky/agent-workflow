import type { HostingProvider } from '@aw/shared';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { credentialsTable } from '../credentials/index.ts';

/** 10 §hosting_accounts: global GitHub / GitLab tokens, one per platform address (D155). */
export const hostingAccountsTable = sqliteTable('hosting_accounts', {
  id: text('id').primaryKey(),
  provider: text('provider').$type<HostingProvider>().notNull(),
  /** Self-hosted GitLab address without a trailing slash; null for github.com and gitlab.com. */
  baseUrl: text('base_url'),
  /** The user name the token signs in as, read when it was saved. */
  account: text('account').notNull(),
  credentialId: text('credential_id')
    .notNull()
    .references(() => credentialsTable.id),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
