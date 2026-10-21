import { type CredentialPortResponse, credentialPortRequestSchema } from '@aw/shared';
import { safeStorage, type UtilityProcess } from 'electron';

/**
 * Why safeStorage cannot protect secrets, if it cannot. On Linux without a secret service Chromium selects
 * `basic_text`, a key hard-coded in its source, and still reports encryption as available (D70).
 */
function unavailableReason(): string | undefined {
  if (!safeStorage.isEncryptionAvailable()) return 'safeStorage encryption is not available';
  if (process.platform !== 'linux') return undefined;
  const backend = safeStorage.getSelectedStorageBackend();
  return backend === 'basic_text' || backend === 'unknown'
    ? `no secret service (safeStorage backend ${backend})`
    : undefined;
}

/** Answers the backend's credential requests with safeStorage (the backend never sees the OS keychain). */
export function serveCredentialRequests(child: UtilityProcess): void {
  child.on('message', (message: unknown) => {
    const parsed = credentialPortRequestSchema.safeParse(message);
    if (!parsed.success) return;
    const { id, op, data } = parsed.data;
    let response: CredentialPortResponse;
    const reason = unavailableReason();
    if (reason !== undefined) {
      response = { type: 'credential.response', id, ok: false, error: reason };
    } else {
      try {
        const result =
          op === 'status'
            ? ''
            : op === 'encrypt'
              ? safeStorage.encryptString(data).toString('base64')
              : safeStorage.decryptString(Buffer.from(data, 'base64'));
        response = { type: 'credential.response', id, ok: true, data: result };
      } catch (err) {
        // Translate: the backend maps this to CREDENTIAL_UNAVAILABLE.
        response = {
          type: 'credential.response',
          id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    child.postMessage(response);
  });
}
