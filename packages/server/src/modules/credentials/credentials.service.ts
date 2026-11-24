import { randomUUID } from 'node:crypto';
import {
  AppError,
  assertNever,
  type CredentialKind,
  CredentialSeal,
  type CredentialStatusDTO,
  ErrorCode,
  MasterPasswordState,
} from '@aw/shared';
import { eq } from 'drizzle-orm';
import type { Clock } from '../../core/clock.ts';
import type { Db, DbExecutor } from '../../core/db/database.ts';
import type { CredentialCipher } from './cipher.ts';
import { credentialsTable } from './credentials.table.ts';
import { createMasterPassword } from './master-password.ts';

export type CredentialsServiceDeps = { db: Db; clock: Clock; cipher: CredentialCipher };

/** The only reader and writer of secrets (06 §11); other modules keep just the credential id. */
export function createCredentialsService({ db, clock, cipher }: CredentialsServiceDeps) {
  const masterPassword = createMasterPassword({ db, clock });
  const unlockListeners = new Set<() => Promise<void>>();

  /** The OS key store when it works, else the master password (D167). */
  async function seal(secret: string): Promise<{ seal: CredentialSeal; ciphertext: Buffer; generation?: number }> {
    if (await cipher.isAvailable()) {
      return { seal: CredentialSeal.System, ciphertext: Buffer.from(await cipher.encrypt(secret)) };
    }
    return {
      seal: CredentialSeal.MasterPassword,
      ciphertext: masterPassword.encrypt(secret),
      generation: masterPassword.generation(),
    };
  }

  async function status(): Promise<CredentialStatusDTO> {
    const system = await cipher.isAvailable();
    const state = masterPassword.state();
    return { available: system || state === MasterPasswordState.Unlocked, system, masterPassword: state };
  }

  function assertSealCurrent(generation: number | undefined) {
    if (generation !== undefined && generation !== masterPassword.generation())
      throw new AppError(
        ErrorCode.CredentialUnavailable,
        'The credential vault was reset before encryption could be committed',
      );
  }

  async function prepare(kind: CredentialKind, secret: string) {
    const { generation, ...sealed } = await seal(secret);
    const record = { id: randomUUID(), kind, ...sealed, createdAt: clock.now() };
    return {
      id: record.id,
      save(executor: DbExecutor) {
        assertSealCurrent(generation);
        executor.insert(credentialsTable).values(record).run();
      },
    };
  }

  return {
    /** Encrypt outside a synchronous transaction, then store with the record that owns the secret. */
    prepare,
    async create(kind: CredentialKind, secret: string): Promise<string> {
      const prepared = await prepare(kind, secret);
      prepared.save(db);
      return prepared.id;
    },
    async replace(id: string, secret: string): Promise<void> {
      const { generation, ...sealed } = await seal(secret);
      assertSealCurrent(generation);
      const { changes } = db.update(credentialsTable).set(sealed).where(eq(credentialsTable.id, id)).run();
      if (changes === 0) throw new AppError(ErrorCode.NotFound, `Credential ${id} not found`);
    },
    /** Decrypts for immediate use; never return the result through an API or MCP response. */
    async reveal(id: string): Promise<string> {
      const row = db.select().from(credentialsTable).where(eq(credentialsTable.id, id)).get();
      if (row === undefined) throw new AppError(ErrorCode.NotFound, `Credential ${id} not found`);
      switch (row.seal) {
        case CredentialSeal.System:
          return cipher.decrypt(row.ciphertext);
        case CredentialSeal.MasterPassword:
          return masterPassword.decrypt(row.ciphertext);
        case CredentialSeal.Discarded:
          throw new AppError(ErrorCode.CredentialLost, `Credential ${id} was discarded with the master password`);
        default:
          return assertNever(row.seal);
      }
    },
    status,
    remove(id: string, executor: DbExecutor = db): void {
      executor.delete(credentialsTable).where(eq(credentialsTable.id, id)).run();
    },
    async setupMasterPassword(password: string): Promise<CredentialStatusDTO> {
      await masterPassword.setup(password);
      return status();
    },
    onUnlock(listener: () => Promise<void>): void {
      unlockListeners.add(listener);
    },
    async unlock(password: string): Promise<CredentialStatusDTO> {
      await masterPassword.unlock(password);
      for (const listener of unlockListeners) await listener();
      return status();
    },
    async changeMasterPassword(currentPassword: string, newPassword: string): Promise<CredentialStatusDTO> {
      await masterPassword.change(currentPassword, newPassword);
      return status();
    },
    /** Forgotten password: its secrets cannot be opened again; the rows stay so their owners can re-enter them. */
    async resetMasterPassword(): Promise<CredentialStatusDTO> {
      await masterPassword.reset((tx) =>
        tx
          .update(credentialsTable)
          .set({ seal: CredentialSeal.Discarded, ciphertext: Buffer.alloc(0) })
          .where(eq(credentialsTable.seal, CredentialSeal.MasterPassword))
          .run(),
      );
      return status();
    },
  };
}
export type CredentialsService = ReturnType<typeof createCredentialsService>;
