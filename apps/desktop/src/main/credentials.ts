import type { CredentialCipher } from '@aw/server/startup-environment';
import { AppError, type CredentialPortResponse, credentialPortRequestSchema, ErrorCode } from '@aw/shared';
import { safeStorage, type UtilityProcess } from 'electron';

/**
 * Why safeStorage cannot protect secrets, if it cannot. On Linux without a secret service Chromium selects
 * `basic_text`, a key hard-coded in its source (D74). Electron 44 reports that as unavailable unless
 * `setUsePlainTextEncryption` is on, but the backend is checked too: being wrong here would write secrets in the clear.
 * Without a store the backend falls back to the master password (D167).
 */
function unavailableReason(): string | undefined {
  if (!safeStorage.isEncryptionAvailable()) return 'safeStorage encryption is not available';
  if (process.platform !== 'linux') return undefined;
  const backend = safeStorage.getSelectedStorageBackend();
  return backend === 'basic_text' || backend === 'unknown'
    ? `no secret service (safeStorage backend ${backend})`
    : undefined;
}

function requireSafeStorage(): void {
  const reason = unavailableReason();
  if (reason !== undefined) throw new AppError(ErrorCode.CredentialUnavailable, reason);
}

/** The same OS key store serves read-only pre-fork resolution and the backend's credential IPC. */
export const desktopCredentialCipher: CredentialCipher = {
  isAvailable: async () => unavailableReason() === undefined,
  async encrypt(value) {
    requireSafeStorage();
    try {
      return safeStorage.encryptString(value);
    } catch {
      throw new AppError(ErrorCode.CredentialUnavailable, 'safeStorage could not encrypt the credential');
    }
  },
  async decrypt(value) {
    requireSafeStorage();
    try {
      return safeStorage.decryptString(Buffer.from(value));
    } catch {
      throw new AppError(ErrorCode.CredentialUnavailable, 'safeStorage could not decrypt the credential');
    }
  },
};

/** Answers the backend's credential requests with safeStorage (the backend never sees the OS keychain). */
export function serveCredentialRequests(child: UtilityProcess): void {
  child.on('message', async (message: unknown) => {
    const parsed = credentialPortRequestSchema.safeParse(message);
    if (!parsed.success) return;
    const { id, op, data } = parsed.data;
    let response: CredentialPortResponse;
    try {
      let result: string;
      if (op === 'status') {
        requireSafeStorage();
        result = '';
      } else if (op === 'encrypt') {
        result = Buffer.from(await desktopCredentialCipher.encrypt(data)).toString('base64');
      } else {
        result = await desktopCredentialCipher.decrypt(Buffer.from(data, 'base64'));
      }
      response = { type: 'credential.response', id, ok: true, data: result };
    } catch (error) {
      response = {
        type: 'credential.response',
        id,
        ok: false,
        error: error instanceof AppError ? error.message : 'The OS credential request failed',
      };
    }
    child.postMessage(response);
  });
}
