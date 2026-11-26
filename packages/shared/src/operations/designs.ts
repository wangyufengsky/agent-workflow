import { z } from 'zod';
import {
  createDesignRequestSchema,
  createDesignTemplateRequestSchema,
  designSchema,
  designSectionRefSchema,
  designStalenessSchema,
  designTemplateRefSchema,
  exportDesignRequestSchema,
  generateDesignRequestSchema,
  listDesignsQuerySchema,
  listDesignsResponseSchema,
  listDesignTemplatesQuerySchema,
  listDesignTemplatesResponseSchema,
  reviewDesignRequestSchema,
  reviseDesignOutlineRequestSchema,
  reviseDesignSectionRequestSchema,
  updateDesignOutlineRequestSchema,
  updateDesignRequestSchema,
  updateDesignTemplateRequestSchema,
} from '../contracts/api/designs.ts';
import { designTemplateSchema } from '../contracts/design/template.ts';
import { EntityKind, InputRef } from '../enums/entity.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

const byId = z.object({ id: z.string().min(1) });
const common = { expose: { palette: false, assistant: true }, credentialFields: [], mode: UiMode.Pro } as const;
const designRef = { id: InputRef.Design } as const;

export const listDesignsOp = defineOperationContract({
  ...common,
  id: 'designs.list',
  title: 'op.designs.list',
  description: 'Find project designs by project or title, with most recent updates first',
  input: listDesignsQuerySchema,
  output: listDesignsResponseSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/designs' },
  refs: { projectId: InputRef.Project },
});

export const getDesignOp = defineOperationContract({
  ...common,
  id: 'designs.get',
  title: 'op.designs.get',
  description: 'Read one project design, including sections, files, diagrams and AI runs',
  input: byId,
  output: designSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/designs/:id' },
  refs: designRef,
});

export const getDesignStalenessOp = defineOperationContract({
  ...common,
  id: 'designs.staleness',
  title: 'op.designs.staleness',
  description: 'Check whether project files have changed since this design was scanned',
  input: byId,
  output: designStalenessSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/designs/:id/staleness' },
  refs: designRef,
});

export const getDesignSourceOp = defineOperationContract({
  ...common,
  expose: { palette: false, assistant: false },
  id: 'designs.source',
  title: 'op.designs.source',
  description: 'Read the local source file if it still matches the scanned revision',
  input: byId.extend({ fileId: z.string().min(1) }),
  output: z.union([
    z.object({ status: z.literal('available'), content: z.string() }),
    z.object({ status: z.enum(['changed', 'unavailable']) }),
  ]),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/designs/:id/files/:fileId/source' },
  refs: designRef,
});

export const createDesignOp = defineOperationContract({
  ...common,
  id: 'designs.create',
  title: 'op.designs.create',
  description: 'Scan the project and create a draft design outline without calling any AI model',
  input: createDesignRequestSchema,
  output: designSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/designs', status: 201 },
  refs: { projectId: InputRef.Project },
  produces: { kind: EntityKind.Design, ref: ({ id, title }) => ({ id, title }) },
});

export const updateDesignOp = defineOperationContract({
  ...common,
  id: 'designs.update',
  title: 'op.designs.update',
  description: 'Rename a design or change its presentation and review settings',
  input: updateDesignRequestSchema,
  output: designSchema,
  risk: OperationRisk.Write,
  http: { method: 'PATCH', path: '/designs/:id' },
  refs: designRef,
});

export const listDesignTemplatesOp = defineOperationContract({
  ...common,
  id: 'designs.listTemplates',
  title: 'op.designs.listTemplates',
  description: 'List design templates and optionally recommend one from project root features',
  input: listDesignTemplatesQuerySchema,
  output: listDesignTemplatesResponseSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/designs/templates' },
  refs: { projectId: InputRef.Project },
});

export const createDesignTemplateOp = defineOperationContract({
  ...common,
  id: 'designs.createTemplate',
  title: 'op.designs.createTemplate',
  description: 'Create a custom design template, optionally copied from an existing template',
  input: createDesignTemplateRequestSchema,
  output: designTemplateSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/designs/templates', status: 201 },
});

export const updateDesignTemplateOp = defineOperationContract({
  ...common,
  id: 'designs.updateTemplate',
  title: 'op.designs.updateTemplate',
  description: 'Edit a custom design template',
  input: updateDesignTemplateRequestSchema,
  output: designTemplateSchema,
  risk: OperationRisk.Write,
  http: { method: 'PATCH', path: '/designs/templates/:key' },
});

export const deleteDesignTemplateOp = defineOperationContract({
  ...common,
  id: 'designs.deleteTemplate',
  title: 'op.designs.deleteTemplate',
  description: 'Delete a custom template; saved designs keep their template snapshot',
  input: designTemplateRefSchema,
  output: z.void(),
  risk: OperationRisk.Write,
  http: { method: 'DELETE', path: '/designs/templates/:key' },
});

export const updateDesignOutlineOp = defineOperationContract({
  ...common,
  id: 'designs.updateOutline',
  title: 'op.designs.updateOutline',
  description: 'Save the editable outline and checked sections before confirmation',
  input: updateDesignOutlineRequestSchema,
  output: designSchema,
  risk: OperationRisk.Write,
  http: { method: 'PUT', path: '/designs/:id/outline' },
  refs: designRef,
});

export const reviseDesignOutlineOp = defineOperationContract({
  ...common,
  id: 'designs.reviseOutline',
  title: 'op.designs.reviseOutline',
  description: 'Let AI revise the draft design outline before confirmation',
  input: reviseDesignOutlineRequestSchema,
  output: designSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/designs/:id/outline/revise' },
  refs: designRef,
});

export const generateDesignOp = defineOperationContract({
  ...common,
  id: 'designs.generate',
  title: 'op.designs.generate',
  description: 'Confirm the draft outline and generate pending sections, or retry a specified unfinished section',
  input: generateDesignRequestSchema,
  output: designSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/designs/:id/generate' },
  refs: designRef,
});

export const reviseDesignSectionOp = defineOperationContract({
  ...common,
  id: 'designs.reviseSection',
  title: 'op.designs.reviseSection',
  description: 'Let AI rewrite one completed section and keep its previous version',
  input: reviseDesignSectionRequestSchema,
  output: designSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/designs/:id/sections/:sectionId/revise' },
  refs: designRef,
});

export const restoreDesignSectionOp = defineOperationContract({
  ...common,
  id: 'designs.restoreSection',
  title: 'op.designs.restoreSection',
  description: 'Restore the previous version of a section',
  input: designSectionRefSchema,
  output: designSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/designs/:id/sections/:sectionId/restore' },
  refs: designRef,
});

export const reviewDesignOp = defineOperationContract({
  ...common,
  id: 'designs.review',
  title: 'op.designs.review',
  description: 'Run an independent AI review of a completed design',
  input: reviewDesignRequestSchema,
  output: designSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/designs/:id/review' },
  refs: designRef,
});

export const stopDesignOp = defineOperationContract({
  ...common,
  id: 'designs.stop',
  title: 'op.designs.stop',
  description: 'Stop the active work and keep the completed sections',
  input: byId,
  output: designSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/designs/:id/stop' },
  refs: designRef,
});

export const exportDesignOp = defineOperationContract({
  ...common,
  id: 'designs.export',
  title: 'op.designs.export',
  description: 'Export the rendered design as a self-contained offline HTML site',
  input: exportDesignRequestSchema,
  output: designSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/designs/:id/export' },
  refs: designRef,
});

export const deleteDesignOp = defineOperationContract({
  ...common,
  id: 'designs.delete',
  title: 'op.designs.delete',
  description: 'Delete a design and its AI run history',
  input: byId,
  output: z.void(),
  risk: OperationRisk.Critical,
  http: { method: 'DELETE', path: '/designs/:id' },
  refs: designRef,
});
