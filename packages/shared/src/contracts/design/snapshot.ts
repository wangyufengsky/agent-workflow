import { z } from 'zod';
import { designBlockSchema, designLineSchema, designRelativePathSchema } from './block.ts';
import { designDiagramSchema } from './diagram.ts';
import { designFileContentSchema } from './file.ts';

export const designSourceSnapshotSchema = z.strictObject({
  branch: z.string().nullable(),
  commitSha: z.string().nullable(),
  dirty: z.boolean(),
  scannedAt: z.number(),
  analyzableCount: z.int().nonnegative(),
  skippedCount: z.int().nonnegative(),
  skippedReasons: z.record(z.string(), z.int().nonnegative()),
  techStack: z.array(z.string()),
});
export type DesignSourceSnapshot = z.infer<typeof designSourceSnapshotSchema>;

export const designReviewNoteSchema = z.strictObject({
  severity: z.enum(['info', 'warn']),
  message: z.string().trim().min(1),
  relPath: designRelativePathSchema.optional(),
  lineStart: designLineSchema.optional(),
});
export type DesignReviewNote = z.infer<typeof designReviewNoteSchema>;

export const designSourceHashesSchema = z.array(
  z.strictObject({
    relPath: z.string().min(1),
    contentHash: z.string().nullable(),
  }),
);
export type DesignSourceHashes = z.infer<typeof designSourceHashesSchema>;

export const designSectionVersionSchema = z.strictObject({
  summary: z.string(),
  blocks: z.array(designBlockSchema),
  files: z.array(designFileContentSchema),
  diagrams: z.array(designDiagramSchema),
  sourceHashes: designSourceHashesSchema.optional(),
});
export type DesignSectionVersion = z.infer<typeof designSectionVersionSchema>;
