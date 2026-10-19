import { randomUUID } from 'node:crypto';
import { AppError, type CredentialKind, ErrorCode } from '@aw/shared';
import { eq } from 'drizzle-orm';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { CredentialCipher } from './cipher.ts';
import { credentialsTable } from './credentials.table.ts';

export type CredentialsServiceDeps = { db: Db; clock: Clock; cipher: CredentialCipher };

/** The only reader and writer of secrets (06 §11); other modules keep just the credential id. */
export function createCredentialsService({ db, clock, cipher }: CredentialsServiceDeps) {
  return {
    async create(kind: CredentialKind, secret: string): Promise<string> {
      const id = randomUUID();
      const ciphertext = Buffer.from(await cipher.encrypt(secret));
      db.insert(credentialsTable).values({ id, kind, ciphertext, createdAt: clock.now() }).run();
      return id;
    },
    async replace(id: string, secret: string): Promise<void> {
      const ciphertext = Buffer.from(await cipher.encrypt(secret));
      const { changes } = db.update(credentialsTable).set({ ciphertext }).where(eq(credentialsTable.id, id)).run();
      if (changes === 0) throw new AppError(ErrorCode.NotFound, `Credential ${id} not found`);
    },
    /** Decrypts for immediate use; never return the result through an API or MCP response. */
    async reveal(id: string): Promise<string> {
      const row = db.select().from(credentialsTable).where(eq(credentialsTable.id, id)).get();
      if (row === undefined) throw new AppError(ErrorCode.NotFound, `Credential ${id} not found`);
      return cipher.decrypt(row.ciphertext);
    },
    remove(id: string): void {
      db.delete(credentialsTable).where(eq(credentialsTable.id, id)).run();
    },
  };
}
export type CredentialsService = ReturnType<typeof createCredentialsService>;
