import { z } from 'zod';
import { RECALL_PAGE_MAX_CHARS } from '../../constants/limits.ts';

export const recallInputSchema = z.strictObject({
  messageId: z.string().regex(/^msg_[\w-]+$/),
  partId: z.string().regex(/^prt_[\w-]+$/),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive().default(RECALL_PAGE_MAX_CHARS),
});
export const recallOutputSchema = z.object({
  content: z.string(),
  offset: z.number().int().nonnegative(),
  totalLength: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
});
export type RecallInput = z.infer<typeof recallInputSchema>;
export type RecallOutput = z.infer<typeof recallOutputSchema>;
