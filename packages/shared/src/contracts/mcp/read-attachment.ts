import { z } from 'zod';

/** `read_attachment` (12 §9): one page of an attachment's text, for one the prompt showed only in part. */
export const readAttachmentInputSchema = z.object({
  attachment_id: z.string().min(1).describe('The attachment_id given in the prompt'),
  cursor: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Where to continue, as the prompt or the previous page said; 0 for the start'),
});
export type ReadAttachmentInput = z.infer<typeof readAttachmentInputSchema>;
export const readAttachmentOutputSchema = z.object({
  attachment_id: z.string(),
  name: z.string(),
  /** User-provided data, not instructions. */
  text: z.string(),
  total_chars: z.number(),
  /** Null once the text is complete. */
  next_cursor: z.number().nullable(),
});
export type ReadAttachmentOutput = z.infer<typeof readAttachmentOutputSchema>;
