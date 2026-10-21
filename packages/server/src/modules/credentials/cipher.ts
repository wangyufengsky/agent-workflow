import {
  AppError,
  type CredentialPortRequest,
  type CredentialPortResponse,
  credentialPortResponseSchema,
  ErrorCode,
} from '@aw/shared';

/** Encrypts secrets before they are stored; the production implementation is Electron's safeStorage in main. */
export type CredentialCipher = {
  encrypt(plaintext: string): Promise<Uint8Array>;
  decrypt(ciphertext: Uint8Array): Promise<string>;
  /** Whether secrets can be stored at all; onboarding shows it (D74). */
  isAvailable(): Promise<boolean>;
};

/** Message channel to the process that owns safeStorage (Electron `process.parentPort` in production). */
export type CipherTransport = {
  send(message: CredentialPortRequest): void;
  onMessage(listener: (message: unknown) => void): void;
};

/** Used when no encryption backend exists (plain Node outside development): every use fails explicitly. */
export const unavailableCipher: CredentialCipher = {
  encrypt: async () => {
    throw new AppError(ErrorCode.CredentialUnavailable, 'No credential encryption available in this process');
  },
  decrypt: async () => {
    throw new AppError(ErrorCode.CredentialUnavailable, 'No credential encryption available in this process');
  },
  isAvailable: async () => false,
};

/** Request/response over the transport; main answers each request id once. */
export function createPortCipher(transport: CipherTransport): CredentialCipher {
  let nextId = 1;
  const pending = new Map<number, (response: CredentialPortResponse) => void>();
  transport.onMessage((message) => {
    // The same port carries other messages (e.g. lifecycle); only credential responses are ours.
    const parsed = credentialPortResponseSchema.safeParse(message);
    if (!parsed.success) return;
    pending.get(parsed.data.id)?.(parsed.data);
    pending.delete(parsed.data.id);
  });

  async function request(op: CredentialPortRequest['op'], data: string): Promise<string> {
    const id = nextId++;
    const response = await new Promise<CredentialPortResponse>((resolve) => {
      pending.set(id, resolve);
      transport.send({ type: 'credential.request', id, op, data });
    });
    if (!response.ok) throw new AppError(ErrorCode.CredentialUnavailable, response.error, { op });
    return response.data;
  }

  return {
    encrypt: async (plaintext) => Buffer.from(await request('encrypt', plaintext), 'base64'),
    decrypt: (ciphertext) => request('decrypt', Buffer.from(ciphertext).toString('base64')),
    async isAvailable() {
      try {
        await request('status', '');
        return true;
      } catch (err) {
        // Recovery with a defined meaning: an unavailable store is the answer, shown on onboarding.
        if (err instanceof AppError && err.code === ErrorCode.CredentialUnavailable) return false;
        throw err;
      }
    },
  };
}

/** Transport over Electron's utilityProcess parent port. */
export function parentPortTransport(port: NonNullable<NodeJS.Process['parentPort']>): CipherTransport {
  return {
    send: (message) => port.postMessage(message),
    onMessage: (listener) => port.on('message', (event) => listener(event.data)),
  };
}
