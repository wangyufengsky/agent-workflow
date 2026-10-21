import type { CredentialCipher } from '../../src/modules/credentials/index.ts';

/** Reversible stand-in for safeStorage in tests that store credentials (the stored bytes differ from the secret). */
export const testCipher: CredentialCipher = {
  encrypt: async (plaintext) => Uint8Array.from(Buffer.from(plaintext, 'utf8'), (b) => b ^ 0x5a),
  decrypt: async (ciphertext) => Buffer.from(Uint8Array.from(ciphertext, (b) => b ^ 0x5a)).toString('utf8'),
  isAvailable: async () => true,
};
