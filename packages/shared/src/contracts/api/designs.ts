import { z } from 'zod';
import {
  DESIGN_IMPACT_LOOKUP_MAX_PATHS,
  DESIGN_IMPACT_MAX_DEPTH,
  DESIGN_IMPACT_MAX_ITEMS,
  DESIGN_INSTRUCTION_MAX_CHARS,
  DESIGN_MAX_SECTIONS,
  LIST_PAGE_DEFAULT,
  LIST_PAGE_MAX,
} from '../../constants/limits.ts';
import {
  designDepthSchema,
  designFileChangeKindSchema,
  designLayoutStyleSchema,
  designReviewStateSchema,
  designRunKindSchema,
  designSectionKindSchema,
  designStalenessStateSchema,
  designStatusSchema,
} from '../../enums/design.ts';
import { GitImpactClassification, gitImpactTargetKindSchema } from '../../enums/git.ts';
import { permissionModeSchema } from '../../enums/system.ts';
import { themeIdSchema } from '../../enums/ui.ts';
import { designBlockSchema, designRelativePathSchema, designTitleSchema } from '../design/block.ts';
import { designDiagramSchema } from '../design/diagram.ts';
import { designSymbolSchema } from '../design/file.ts';
import { designReviewNoteSchema, designSourceSnapshotSchema } from '../design/snapshot.ts';
import { designOutlineSectionSchema, designTemplateSchema, designTemplateSnapshotSchema } from '../design/template.ts';
import { attemptSummarySchema } from './attempts.ts';
import { modelChoiceSchema } from './knowledge.ts';

const id = z.string().min(1);
const byId = z.object({ id });
const count = z.int().nonnegative();
const instruction = z.string().trim().min(1).max(DESIGN_INSTRUCTION_MAX_CHARS);
export const designSectionRefSchema = byId.extend({ sectionId: id });
export const designTemplateRefSchema = z.object({ key: id });

export const designStalenessSchema = z.strictObject({
  state: designStalenessStateSchema,
  reason: z.string().min(1).optional(),
  baseSha: id.optional(),
  headSha: id.optional(),
  changedFilesCount: count,
  affectedSectionIds: z.array(id),
  changedPathsSample: z.array(z.string().min(1)),
  changedFilesSample: z
    .array(z.object({ relPath: designRelativePathSchema, kind: designFileChangeKindSchema }))
    .optional(),
});
export type DesignStalenessDTO = z.infer<typeof designStalenessSchema>;

export const lookupDesignImpactRequestSchema = byId.extend({
  paths: z.array(designRelativePathSchema).max(DESIGN_IMPACT_LOOKUP_MAX_PATHS),
});
export type LookupDesignImpactRequest = z.infer<typeof lookupDesignImpactRequestSchema>;

const designImpactCandidateSchema = z.strictObject({
  targetKind: gitImpactTargetKindSchema,
  targetId: id,
  title: id,
  relPath: designRelativePathSchema.optional(),
  classification: z.enum([GitImpactClassification.Direct, GitImpactClassification.Indirect]),
  distance: count.max(DESIGN_IMPACT_MAX_DEPTH),
  sourcePath: id,
});

export const designImpactLookupSchema = z.strictObject({
  designId: id,
  snapshotSha: id.nullable(),
  dirty: z.boolean(),
  coverage: z.strictObject({ doneSections: count, totalSections: count }),
  candidates: z.array(designImpactCandidateSchema).max(DESIGN_IMPACT_MAX_ITEMS),
  uncoveredPaths: z.array(designRelativePathSchema).max(DESIGN_IMPACT_LOOKUP_MAX_PATHS),
  truncated: z.boolean(),
});
export type DesignImpactLookupDTO = z.infer<typeof designImpactLookupSchema>;

export const designSummarySchema = byId.extend({
  title: designTitleSchema,
  projectId: id.nullable(),
  project: z.object({ id, name: z.string() }).nullable(),
  status: designStatusSchema,
  templateKey: id,
  templateName: z.string(),
  branch: z.string().nullable(),
  commitSha: z.string().nullable(),
  scannedAt: z.number(),
  analyzableCount: count,
  analyzedCount: count,
  totalSections: count,
  doneSections: count,
  updatedAt: z.number(),
});
export type DesignSummaryDTO = z.infer<typeof designSummarySchema>;

export const designSectionSchema = byId.extend({
  seq: z.int().positive(),
  selected: z.boolean(),
  kind: designSectionKindSchema,
  title: designTitleSchema,
  scopePaths: z.array(designRelativePathSchema),
  summary: z.string(),
  blocks: z.array(designBlockSchema).nullable(),
  reviewState: designReviewStateSchema,
  reviewNotes: z.array(designReviewNoteSchema).nullable(),
  hasPrevious: z.boolean(),
  updatedAt: z.number(),
});
export type DesignSectionDTO = z.infer<typeof designSectionSchema>;

export const designFileSchema = byId.extend({
  sectionId: id.nullable(),
  relPath: designRelativePathSchema,
  contentHash: z.string(),
  responsibility: z.string().nullable(),
  symbols: z.array(designSymbolSchema),
  updatedAt: z.number(),
});
export type DesignFileDTO = z.infer<typeof designFileSchema>;

export const designDiagramDtoSchema = designDiagramSchema.extend({ sectionId: id, updatedAt: z.number() });
export type DesignDiagramDTO = z.infer<typeof designDiagramDtoSchema>;

export const designRunSchema = byId.extend({
  seq: z.int().positive(),
  kind: designRunKindSchema,
  isIncremental: z.boolean().optional(),
  attempt: attemptSummarySchema,
  targetSectionIds: z.array(id),
  doneSectionIds: z.array(id),
  instruction: z.string().nullable(),
  awaitingInput: z.boolean(),
  createdAt: z.number(),
});
export type DesignRunDTO = z.infer<typeof designRunSchema>;

export const designSchema = designSummarySchema.extend({
  depth: designDepthSchema,
  layoutStyle: designLayoutStyleSchema,
  theme: themeIdSchema,
  excludePatterns: z.array(z.string()),
  aiReviewEnabled: z.boolean(),
  permissionMode: permissionModeSchema,
  templateSnapshot: designTemplateSnapshotSchema,
  sourceSnapshot: designSourceSnapshotSchema,
  outlineConfirmedAt: z.number().nullable(),
  lastExportedPath: z.string().nullable(),
  lastExportedAt: z.number().nullable(),
  createdAt: z.number(),
  sections: z.array(designSectionSchema),
  files: z.array(designFileSchema),
  diagrams: z.array(designDiagramDtoSchema),
  runs: z.array(designRunSchema),
  activeRunId: id.nullable(),
  handoffPending: z.boolean(),
});
export type DesignDTO = z.infer<typeof designSchema>;

export const listDesignsQuerySchema = z.object({
  projectId: id.optional(),
  query: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(LIST_PAGE_MAX).default(LIST_PAGE_DEFAULT),
  cursor: z
    .string()
    .regex(/^\d+\.[\w-]+$/)
    .optional(),
});
export type ListDesignsQuery = z.infer<typeof listDesignsQuerySchema>;
export const listDesignsResponseSchema = z.object({
  items: z.array(designSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ListDesignsResponse = z.infer<typeof listDesignsResponseSchema>;

export const createDesignRequestSchema = z.object({
  projectId: id,
  templateKey: id.optional(),
  depth: designDepthSchema.optional(),
  layoutStyle: designLayoutStyleSchema.optional(),
  excludePatterns: z.array(z.string().trim().min(1)).optional(),
  aiReviewEnabled: z.boolean().optional(),
  permissionMode: permissionModeSchema.optional(),
  theme: themeIdSchema.optional(),
});
export type CreateDesignRequest = z.infer<typeof createDesignRequestSchema>;
export const updateDesignRequestSchema = byId.extend({
  title: designTitleSchema.optional(),
  layoutStyle: designLayoutStyleSchema.optional(),
  aiReviewEnabled: z.boolean().optional(),
  permissionMode: permissionModeSchema.optional(),
  theme: themeIdSchema.optional(),
});
export type UpdateDesignRequest = z.infer<typeof updateDesignRequestSchema>;

export const updateDesignOutlineRequestSchema = byId.extend({
  sections: z.array(designOutlineSectionSchema).min(1).max(DESIGN_MAX_SECTIONS),
});
export type UpdateDesignOutlineRequest = z.infer<typeof updateDesignOutlineRequestSchema>;
export const reviseDesignOutlineRequestSchema = byId.extend({
  generateAfterPlanning: z.boolean().optional(),
  instruction: instruction.optional(),
  model: modelChoiceSchema,
});
export type ReviseDesignOutlineRequest = z.infer<typeof reviseDesignOutlineRequestSchema>;
export const generateDesignRequestSchema = byId.extend({ sectionId: id.optional(), model: modelChoiceSchema });
export type GenerateDesignRequest = z.infer<typeof generateDesignRequestSchema>;
export const incrementalUpdateDesignRequestSchema = byId.extend({
  sectionIds: z
    .array(id)
    .min(1)
    .max(DESIGN_MAX_SECTIONS)
    .refine((ids) => new Set(ids).size === ids.length),
  instruction: instruction.optional(),
});
export type IncrementalUpdateDesignRequest = z.infer<typeof incrementalUpdateDesignRequestSchema>;
export const reviseDesignSectionRequestSchema = designSectionRefSchema.extend({
  instruction,
  focusPath: designRelativePathSchema.optional(),
  focusSymbol: id.optional(),
  focusDiagramId: id.optional(),
  model: modelChoiceSchema,
});
export type ReviseDesignSectionRequest = z.infer<typeof reviseDesignSectionRequestSchema>;
export const reviewDesignRequestSchema = byId.extend({ model: modelChoiceSchema });
export type ReviewDesignRequest = z.infer<typeof reviewDesignRequestSchema>;
export const exportDesignRequestSchema = byId.extend({
  targetDir: z.string().min(1),
  overwrite: z.boolean().optional(),
});
export type ExportDesignRequest = z.infer<typeof exportDesignRequestSchema>;

export const listDesignTemplatesQuerySchema = z.object({ projectId: id.optional() });
export type ListDesignTemplatesQuery = z.infer<typeof listDesignTemplatesQuerySchema>;
export const listDesignTemplatesResponseSchema = z.object({
  items: z.array(designTemplateSchema),
  suggested: z.object({ recommendedTemplateKey: id, techStack: z.array(z.string()) }).nullable(),
});
export type ListDesignTemplatesResponse = z.infer<typeof listDesignTemplatesResponseSchema>;

const editableTemplate = designTemplateSchema.pick({
  name: true,
  description: true,
  defaultSections: true,
  focusPrompt: true,
});
export const createDesignTemplateRequestSchema = editableTemplate.extend({ baseKey: id.optional() });
export type CreateDesignTemplateRequest = z.infer<typeof createDesignTemplateRequestSchema>;
export const updateDesignTemplateRequestSchema = editableTemplate.partial().extend({ key: id });
export type UpdateDesignTemplateRequest = z.infer<typeof updateDesignTemplateRequestSchema>;
