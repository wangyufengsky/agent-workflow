import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { AppError, ErrorCode, MASTER_PASSWORD_SCRYPT, MasterPasswordState } from '@aw/shared';
import { eq } from 'drizzle-orm';
import type { Clock } from '../../core/clock.ts';
import type { Db, DbExecutor } from '../../core/db/database.ts';
import { credentialVaultTable } from './credentials.table.ts';

const VAULT_ID = 1;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

type ScryptParams = { N: number; r: number; p: number };

function deriveKey(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  // scrypt needs 128·N·r bytes; Node's default ceiling (32 MiB) is below the cost we chose.
  const options = { ...params, maxmem: 256 * params.N * params.r };
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFC'), salt, KEY_BYTES, options, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** AES-256-GCM: nonce | ciphertext | tag. */
function seal(key: Buffer, plaintext: Buffer): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  return Buffer.concat([nonce, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

/** Throws when the key is wrong or the bytes were changed (the GCM tag does not match). */
function open(key: Buffer, sealed: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, NONCE_BYTES));
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
  return Buffer.concat([decipher.update(sealed.subarray(NONCE_BYTES, sealed.length - TAG_BYTES)), decipher.final()]);
}

async function wrap(password: string, dataKey: Buffer) {
  const salt = randomBytes(SALT_BYTES);
  const { N, r, p } = MASTER_PASSWORD_SCRYPT;
  const wrappedKey = seal(await deriveKey(password, salt, MASTER_PASSWORD_SCRYPT), dataKey);
  return { salt, scryptN: N, scryptR: r, scryptP: p, wrappedKey };
}

/**
 * The master password where the OS has no key store (D167). The data key lives only in this process's memory, from
 * unlocking until the backend exits; on disk there is only the wrapped key.
 */
export function createMasterPassword({ db, clock }: { db: Db; clock: Clock }) {
  let dataKey: Buffer | undefined;
  // Setup, unlock, change and reset run one at a time: each awaits scrypt, and a reset landing in that gap would have
  // the key it discarded put back when the derivation finishes.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.then(work);
    // The caller gets `result` with its error; the queue only needs to know it settled.
    queue = result.catch(() => undefined);
    return result;
  }
  const row = () => db.select().from(credentialVaultTable).where(eq(credentialVaultTable.id, VAULT_ID)).get();

  async function unwrap(password: string): Promise<Buffer> {
    const vault = row();
    if (vault === undefined) throw new AppError(ErrorCode.MasterPasswordNotSet, 'No master password is set');
    const kek = await deriveKey(password, vault.salt, { N: vault.scryptN, r: vault.scryptR, p: vault.scryptP });
    try {
      return open(kek, vault.wrappedKey);
    } catch {
      // Translation: a key that does not authenticate is a wrong password.
      throw new AppError(ErrorCode.MasterPasswordIncorrect, 'Master password does not open the vault');
    }
  }

  function unlockedKey(): Buffer {
    if (dataKey !== undefined) return dataKey;
    if (row() === undefined) {
      throw new AppError(ErrorCode.CredentialUnavailable, 'No OS key store and no master password');
    }
    throw new AppError(ErrorCode.CredentialLocked, 'Master password not entered since start');
  }

  return {
    state(): MasterPasswordState {
      if (dataKey !== undefined) return MasterPasswordState.Unlocked;
      return row() === undefined ? MasterPasswordState.None : MasterPasswordState.Locked;
    },
    setup: (password: string): Promise<void> =>
      serial(async () => {
        if (row() !== undefined) throw new AppError(ErrorCode.MasterPasswordExists, 'A master password is set');
        const key = randomBytes(KEY_BYTES);
        const now = clock.now();
        db.insert(credentialVaultTable)
          .values({ id: VAULT_ID, ...(await wrap(password, key)), createdAt: now, updatedAt: now })
          .run();
        dataKey = key;
      }),
    unlock: (password: string): Promise<void> =>
      serial(async () => {
        dataKey = await unwrap(password);
      }),
    change: (currentPassword: string, newPassword: string): Promise<void> =>
      serial(async () => {
        const key = await unwrap(currentPassword);
        const wrapped = await wrap(newPassword, key);
        db.update(credentialVaultTable)
          .set({ ...wrapped, updatedAt: clock.now() })
          .where(eq(credentialVaultTable.id, VAULT_ID))
          .run();
        dataKey = key;
      }),
    /** Forgets the password and its key; `discardSealed` drops what the key sealed in the same transaction. */
    reset: (discardSealed: (tx: DbExecutor) => void): Promise<void> =>
      serial(async () => {
        db.transaction((tx) => {
          discardSealed(tx);
          tx.delete(credentialVaultTable).where(eq(credentialVaultTable.id, VAULT_ID)).run();
        });
        dataKey = undefined;
      }),
    encrypt: (plaintext: string): Buffer => seal(unlockedKey(), Buffer.from(plaintext, 'utf8')),
    decrypt(ciphertext: Buffer): string {
      const key = unlockedKey();
      try {
        return open(key, ciphertext).toString('utf8');
      } catch {
        // Translation: the data key is right (it unwrapped), so the stored bytes are damaged.
        throw new AppError(ErrorCode.CredentialUnavailable, 'Stored credential does not authenticate');
      }
    },
  };
}
export type MasterPassword = ReturnType<typeof createMasterPassword>;
