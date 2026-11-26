import { z } from 'zod';
import { DESIGN_MAX_SECTIONS } from '../../constants/limits.ts';
import { DesignReviewState } from '../../enums/design.ts';
import { designTitleSchema } from '../design/block.ts';
import { designReviewNoteSchema, designSectionVersionSchema } from '../design/snapshot.ts';
import { designProposedSectionSchema } from '../design/template.ts';

export const readDesignSectionInputSchema = z.strictObject({
  sectionId: z.string().min(1),
  field: z.enum(['scopePaths', 'summary', 'blocks', 'files', 'diagrams']),
  offset: z.int().nonnegative().optional(),
});
export type ReadDesignSectionInput = z.infer<typeof readDesignSectionInputSchema>;
export const readDesignSectionOutputSchema = z.strictObject({
  content: z.string(),
  nextOffset: z.int().nonnegative().nullable(),
});

export const listDesignFilesInputSchema = z.strictObject({
  query: z.string().optional(),
  offset: z.int().nonnegative().optional(),
});
export type ListDesignFilesInput = z.infer<typeof listDesignFilesInputSchema>;
export const listDesignFilesOutputSchema = z.strictObject({
  files: z.array(z.strictObject({ relPath: z.string(), sectionId: z.string().nullable() })),
  total: z.int().nonnegative(),
  nextOffset: z.int().nonnegative().nullable(),
});

export const submitDesignOutlineInputSchema = z.strictObject({
  title: designTitleSchema.optional(),
  sections: z.array(designProposedSectionSchema).min(1).max(DESIGN_MAX_SECTIONS),
});
export type SubmitDesignOutlineInput = z.infer<typeof submitDesignOutlineInputSchema>;
export const submitDesignOutlineOutputSchema = z.strictObject({ accepted: z.literal(true) });
export type SubmitDesignOutlineOutput = z.infer<typeof submitDesignOutlineOutputSchema>;

export const submitDesignSectionInputSchema = designSectionVersionSchema.extend({
  sectionId: z.string().min(1),
});
export type SubmitDesignSectionInput = z.infer<typeof submitDesignSectionInputSchema>;
export const submitDesignSectionOutputSchema = z.strictObject({
  remainingSectionIds: z.array(z.string().min(1)),
});
export type SubmitDesignSectionOutput = z.infer<typeof submitDesignSectionOutputSchema>;

export const submitDesignReviewInputSchema = z.strictObject({
  findings: z
    .array(
      z.strictObject({
        sectionId: z.string().min(1),
        reviewState: z.enum([DesignReviewState.Passed, DesignReviewState.NeedsAttention]),
        notes: z.array(designReviewNoteSchema),
      }),
    )
    .min(1)
    .max(DESIGN_MAX_SECTIONS),
});
export type SubmitDesignReviewInput = z.infer<typeof submitDesignReviewInputSchema>;
export const submitDesignReviewOutputSchema = z.strictObject({ accepted: z.literal(true) });
export type SubmitDesignReviewOutput = z.infer<typeof submitDesignReviewOutputSchema>;
