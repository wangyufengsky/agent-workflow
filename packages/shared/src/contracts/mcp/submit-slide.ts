import { z } from 'zod';
import { slideContentSchema, slideNotesSchema } from '../deck/slide.ts';

/** `submit_slide` (23 §7.3): one page of the pages this work makes, by its number in the PPT. */
export const submitSlideInputSchema = z.object({
  page: z.number().int().min(1).describe('Page number in the PPT, from 1, as your instructions list it'),
  content: slideContentSchema,
  notes: slideNotesSchema.default('').describe('Speaker notes: what to say on this page'),
});
export type SubmitSlideInput = z.infer<typeof submitSlideInputSchema>;
export const submitSlideOutputSchema = z.object({
  accepted: z.literal(true),
  /** Pages of this work still to submit; the work is finished when none is left. */
  remaining: z.array(z.number()),
});
