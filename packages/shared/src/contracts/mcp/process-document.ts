import { z } from 'zod';
import { ATTACHMENT_READ_MAX_CHARS } from '../../constants/limits.ts';

export const processDocumentDescription =
  'Delegate reading, drafting or revising document content to the document processor. Supply an instruction and optionally an authorized attachment page, Excel sheet range, or excerpt. Returns the processed text and continuation position. Publish an accepted draft with the caller’s document version tools.';

export const processDocumentInputSchema = z.object({
  instruction: z.string().trim().min(1).max(4000),
  source: z
    .union([
      z.object({ excerpt: z.string().min(1).max(ATTACHMENT_READ_MAX_CHARS) }),
      z.object({ attachment_id: z.string().min(1), sheet: z.string().min(1), range: z.string().optional() }).strict(),
      z.object({ attachment_id: z.string().min(1), cursor: z.number().int().nonnegative().optional() }).strict(),
    ])
    .optional(),
});
export type ProcessDocumentInput = z.infer<typeof processDocumentInputSchema>;
export const processDocumentOutputSchema = z.object({
  text: z.string(),
  next_cursor: z.number().nullable(),
  next_range: z.string().nullable(),
});
