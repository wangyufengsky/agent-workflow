import { z } from 'zod';
import { DESIGN_DIAGRAM_MAX_EDGES, DESIGN_DIAGRAM_MAX_NODES } from '../../constants/limits.ts';
import { DesignEvidenceClass, designDiagramKindSchema } from '../../enums/design.ts';
import { designLineSchema, designRelativePathSchema, designTitleSchema } from './block.ts';

export const designDiagramNodeSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  group: z.string().optional(),
  targetKind: z.enum(['section', 'module', 'file', 'symbol']).optional(),
  targetId: z.string().min(1).optional(),
  relPath: designRelativePathSchema.optional(),
  summary: z.string().optional(),
});
export type DesignDiagramNode = z.infer<typeof designDiagramNodeSchema>;

const relationSchema = z.strictObject({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.string().min(1),
  label: z.string().optional(),
});
export const designDiagramEdgeSchema = z.discriminatedUnion('evidenceClass', [
  relationSchema.extend({
    evidenceClass: z.literal(DesignEvidenceClass.Static),
    evidencePath: designRelativePathSchema,
    lineStart: designLineSchema,
    lineEnd: designLineSchema,
    rationale: z.string().optional(),
  }),
  relationSchema.extend({
    evidenceClass: z.literal(DesignEvidenceClass.Inferred),
    evidencePath: designRelativePathSchema.optional(),
    lineStart: designLineSchema.optional(),
    lineEnd: designLineSchema.optional(),
    rationale: z.string().trim().min(1),
  }),
]);
export type DesignDiagramEdge = z.infer<typeof designDiagramEdgeSchema>;

export const designDiagramSchema = z.strictObject({
  id: z.string().min(1),
  kind: designDiagramKindSchema,
  title: designTitleSchema,
  nodes: z.array(designDiagramNodeSchema).max(DESIGN_DIAGRAM_MAX_NODES),
  edges: z.array(designDiagramEdgeSchema).max(DESIGN_DIAGRAM_MAX_EDGES),
});
export type DesignDiagram = z.infer<typeof designDiagramSchema>;
