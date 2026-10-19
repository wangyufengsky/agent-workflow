import { type CredentialPortResponse, credentialPortRequestSchema } from '@aw/shared';
import { safeStorage, type UtilityProcess } from 'electron';

/** Answers the backend's encrypt / decrypt requests with safeStorage (the backend never sees the OS keychain). */
export function serveCredentialRequests(child: UtilityProcess): void {
  child.on('message', (message: unknown) => {
    const parsed = credentialPortRequestSchema.safeParse(message);
    if (!parsed.success) return;
    const { id, op, data } = parsed.data;
    let response: CredentialPortResponse;
    if (!safeStorage.isEncryptionAvailable()) {
      response = { type: 'credential.response', id, ok: false, error: 'safeStorage encryption is not available' };
    } else {
      try {
        const result =
          op === 'encrypt'
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
