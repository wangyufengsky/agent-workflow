import { type CredentialKind, CredentialSeal } from '@aw/shared';
import { blob, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const credentialsTable = sqliteTable('credentials', {
  id: text('id').primaryKey(),
  kind: text('kind').$type<CredentialKind>().notNull(),
  /** Which key opens `ciphertext` (D167); rows from before the master password are the OS key store's. */
  seal: text('seal').$type<CredentialSeal>().notNull().default(CredentialSeal.System),
  /** safeStorage or master password output (empty once discarded); never logged, never in a DTO. */
  ciphertext: blob('ciphertext', { mode: 'buffer' }).notNull(),
  createdAt: integer('created_at').notNull(),
});

/**
 * 10 §credential_vault: the master password (D167), at most one row (`id` 1). The data key that seals credentials is
 * kept wrapped by a key derived from the password, so changing the password re-wraps it and nothing else.
 */
export const credentialVaultTable = sqliteTable('credential_vault', {
  id: integer('id').primaryKey(),
  salt: blob('salt', { mode: 'buffer' }).notNull(),
  scryptN: integer('scrypt_n').notNull(),
  scryptR: integer('scrypt_r').notNull(),
  scryptP: integer('scrypt_p').notNull(),
  /** nonce | AES-256-GCM(data key) | tag, under the key scrypt derives from the password. */
  wrappedKey: blob('wrapped_key', { mode: 'buffer' }).notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
