import { z } from 'zod';
import { DESIGN_TITLE_MAX_CHARS } from '../../constants/limits.ts';
import { DesignEvidenceClass } from '../../enums/design.ts';

export const designTitleSchema = z.string().trim().min(1).max(DESIGN_TITLE_MAX_CHARS);
export const designLineSchema = z.int().positive();
export const designRelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.includes('\\') &&
      !/^[a-zA-Z]:/.test(path) &&
      !path.includes('\0') &&
      path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
    { message: 'Expected a project-relative POSIX path' },
  );
export const designSourceLocationSchema = z.strictObject({
  relPath: designRelativePathSchema,
  lineStart: designLineSchema,
  lineEnd: designLineSchema,
});
export const designEvidenceSchema = z.discriminatedUnion('evidenceClass', [
  designSourceLocationSchema.extend({ evidenceClass: z.literal(DesignEvidenceClass.Static) }),
  z.strictObject({
    evidenceClass: z.literal(DesignEvidenceClass.Inferred),
    rationale: z.string().trim().min(1),
  }),
]);
export type DesignEvidence = z.infer<typeof designEvidenceSchema>;

export const designBlockSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('markdown'),
    title: designTitleSchema.optional(),
    markdown: z.string().min(1),
    evidence: z.array(designEvidenceSchema).optional(),
  }),
  z.strictObject({
    type: z.literal('table'),
    title: designTitleSchema,
    columns: z.array(z.string()).min(1),
    rows: z.array(z.array(z.string())),
    caption: z.string().optional(),
  }),
  designSourceLocationSchema.extend({
    type: z.literal('code'),
    title: designTitleSchema.optional(),
    language: z.string().min(1),
    code: z.string(),
  }),
  z.strictObject({
    type: z.literal('callout'),
    tone: z.enum(['info', 'warn']),
    title: designTitleSchema,
    body: z.string().min(1),
  }),
  z.strictObject({ type: z.literal('diagram_ref'), diagramId: z.string().min(1) }),
]);
export type DesignBlock = z.infer<typeof designBlockSchema>;
