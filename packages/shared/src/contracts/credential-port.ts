import { z } from 'zod';

/**
 * Backend (utilityProcess) ↔ Electron main messages for safeStorage encryption (03 §1).
 * Ciphertext travels base64-encoded; plaintext never leaves these two processes.
 */
export const credentialPortRequestSchema = z.object({
  type: z.literal('credential.request'),
  id: z.number().int(),
  op: z.enum(['encrypt', 'decrypt']),
  /** encrypt: plaintext; decrypt: base64 ciphertext. */
  data: z.string(),
});
export type CredentialPortRequest = z.infer<typeof credentialPortRequestSchema>;

export const credentialPortResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    type: z.literal('credential.response'),
    id: z.number().int(),
    ok: z.literal(true),
    /** encrypt: base64 ciphertext; decrypt: plaintext. */
    data: z.string(),
  }),
  z.object({ type: z.literal('credential.response'), id: z.number().int(), ok: z.literal(false), error: z.string() }),
]);
export type CredentialPortResponse = z.infer<typeof credentialPortResponseSchema>;
