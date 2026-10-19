import type { CredentialCipher } from './cipher.ts';

// Development only (backend on plain Node, no Electron safeStorage). main.ts imports this module behind a
// `process.env.NODE_ENV === 'development'` check that the production bundle folds to false, so it is not shipped;
// scripts/check-prod-bundle.mjs fails the build if this marker ever appears in out/main.
const MARKER = 'aw-dev-plaintext:';

export const devPlaintextCipher: CredentialCipher = {
  encrypt: async (plaintext) => new TextEncoder().encode(MARKER + plaintext),
  decrypt: async (ciphertext) => new TextDecoder().decode(ciphertext).slice(MARKER.length),
};
