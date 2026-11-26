import { z } from 'zod';
import { DESIGN_INSTRUCTION_MAX_CHARS, DESIGN_MAX_SECTIONS } from '../../constants/limits.ts';
import { designSectionKindSchema, designTemplateKindSchema } from '../../enums/design.ts';
import { designRelativePathSchema, designTitleSchema } from './block.ts';

export const GENERAL_DESIGN_TEMPLATE_KEY = 'general';
export const TRANSACTION_EXPLORER_KEY = 'transaction-explorer';
export const DATA_EXPLORER_KEY = 'data-explorer';

const designOutlineSectionFieldsSchema = z.strictObject({
  kind: designSectionKindSchema,
  title: designTitleSchema,
  scopePaths: z.array(designRelativePathSchema),
});
export const designOutlineSectionSchema = designOutlineSectionFieldsSchema.extend({
  id: z.string().min(1).optional(),
  selected: z.boolean().default(true),
});
export type DesignOutlineSection = z.infer<typeof designOutlineSectionSchema>;

export const designProposedSectionSchema = designOutlineSectionFieldsSchema;

export const designTemplateSectionSchema = z.strictObject({
  kind: designSectionKindSchema,
  title: designTitleSchema,
  scopeHint: z.string(),
});
export type DesignTemplateSection = z.infer<typeof designTemplateSectionSchema>;

export const designTemplateSnapshotSchema = z.strictObject({
  key: z.string().min(1),
  name: designTitleSchema,
  defaultSections: z.array(designTemplateSectionSchema).min(1).max(DESIGN_MAX_SECTIONS),
  focusPrompt: z.string().trim().min(1).max(DESIGN_INSTRUCTION_MAX_CHARS),
});
export type DesignTemplateSnapshot = z.infer<typeof designTemplateSnapshotSchema>;

export const designTemplateSchema = designTemplateSnapshotSchema.extend({
  kind: designTemplateKindSchema,
  description: z.string(),
  matchHints: z.array(z.string()),
  updatedAt: z.number(),
});
export type DesignTemplate = z.infer<typeof designTemplateSchema>;
