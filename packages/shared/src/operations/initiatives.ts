import { z } from 'zod';
import {
  confirmInitiativeItemMergedRequestSchema,
  confirmInitiativeRequestSchema,
  createInitiativeRequestSchema,
  deleteInitiativeRequestSchema,
  deleteInitiativeTemplateRequestSchema,
  deliverInitiativePhaseRequestSchema,
  deliverInitiativePhaseResponseSchema,
  dropInitiativeItemRequestSchema,
  getInitiativeRequestSchema,
  initiativeDetailSchema,
  initiativeSummarySchema,
  initiativeTemplateSchema,
  listInitiativesQuerySchema,
  openInitiativePhaseRequestSchema,
  rebreakdownInitiativeRequestSchema,
  refineInitiativeRequestSchema,
  saveInitiativeDraftRequestSchema,
  saveInitiativeTemplateRequestSchema,
  startInitiativeItemRequestSchema,
} from '../contracts/api/initiatives.ts';
import { EntityKind, InputRef } from '../enums/entity.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

// Initiatives are a simple-mode feature the assistant can use too (34 §10); they start from the home page's panel.
const common = { expose: { palette: false, assistant: true }, credentialFields: [], mode: UiMode.Simple } as const;
const byId = { refs: { id: InputRef.Initiative } } as const;

export const listInitiativeTemplatesOp = defineOperationContract({
  ...common,
  id: 'initiativeTemplates.list',
  title: 'op.initiativeTemplates.list',
  description: 'Composition templates: fixed chains of small workflows in phases, such as design then build',
  input: z.object({}),
  output: z.object({ items: z.array(initiativeTemplateSchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/initiative-templates' },
});

// Custom templates are a pro-mode page of their own (34 §15.6); the assistant only reads them.
const templateEdit = { expose: { palette: false, assistant: false }, credentialFields: [], mode: UiMode.Pro } as const;

export const createInitiativeTemplateOp = defineOperationContract({
  ...templateEdit,
  id: 'initiativeTemplates.create',
  title: 'op.initiativeTemplates.create',
  description: 'Create a custom composition template; at least one work package requirement contains {{requirement}}',
  input: saveInitiativeTemplateRequestSchema,
  output: initiativeTemplateSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/initiative-templates', status: 201 },
});

export const updateInitiativeTemplateOp = defineOperationContract({
  ...templateEdit,
  id: 'initiativeTemplates.update',
  title: 'op.initiativeTemplates.update',
  description: 'Change a custom composition template in place; initiatives made from it keep their copy',
  input: saveInitiativeTemplateRequestSchema,
  output: initiativeTemplateSchema,
  risk: OperationRisk.Write,
  http: { method: 'PUT', path: '/initiative-templates/:key' },
});

export const deleteInitiativeTemplateOp = defineOperationContract({
  ...templateEdit,
  id: 'initiativeTemplates.delete',
  title: 'op.initiativeTemplates.delete',
  description: 'Delete a custom composition template; initiatives made from it keep their copy',
  input: deleteInitiativeTemplateRequestSchema,
  output: z.void(),
  risk: OperationRisk.Critical,
  http: { method: 'DELETE', path: '/initiative-templates/:key' },
});

export const listInitiativesOp = defineOperationContract({
  ...common,
  id: 'initiatives.list',
  title: 'op.initiatives.list',
  description: 'Initiatives (a requirement split into work packages and phases) with their progress, newest first',
  input: listInitiativesQuerySchema,
  output: z.object({ items: z.array(initiativeSummarySchema), nextCursor: z.string().nullable() }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/initiatives' },
});

export const createInitiativeOp = defineOperationContract({
  ...common,
  id: 'initiatives.create',
  title: 'op.initiatives.create',
  description:
    'Start an initiative: with templateKey, from a composition template (each work package an ordinary task in its phase; {{requirement}} replaced by the requirement); without it, the AI breaks the requirement into phases and work packages for the user to confirm',
  input: createInitiativeRequestSchema,
  output: initiativeDetailSchema,
  refs: { projectId: InputRef.Project, attachmentIds: InputRef.Attachment },
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/initiatives', status: 201 },
  produces: {
    kind: EntityKind.Initiative,
    ref: (initiative) => ({ id: initiative.id, title: `${initiative.key} · ${initiative.title}` }),
  },
});

export const getInitiativeOp = defineOperationContract({
  ...common,
  ...byId,
  id: 'initiatives.get',
  title: 'op.initiatives.get',
  description: "An initiative's phases and work packages, each with its task, status and latest delivery",
  input: getInitiativeRequestSchema,
  output: initiativeDetailSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/initiatives/:id' },
});

export const saveInitiativeDraftOp = defineOperationContract({
  ...common,
  ...byId,
  // Rewriting every phase and work package is the page's editor's job.
  expose: { palette: false, assistant: false },
  id: 'initiatives.saveDraft',
  title: 'op.initiatives.saveDraft',
  description:
    'Replace the phases and work packages; work packages that started, finished or were dropped must stay as they are',
  input: saveInitiativeDraftRequestSchema,
  output: initiativeDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'PUT', path: '/initiatives/:id/draft' },
});

export const confirmInitiativeOp = defineOperationContract({
  ...common,
  ...byId,
  id: 'initiatives.confirm',
  title: 'op.initiatives.confirm',
  description: 'Confirm the phases and work packages; the first time, this opens phase 1 and starts its work packages',
  input: confirmInitiativeRequestSchema,
  output: initiativeDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/initiatives/:id/confirm' },
});

export const openInitiativePhaseOp = defineOperationContract({
  ...common,
  ...byId,
  id: 'initiatives.openPhase',
  title: 'op.initiatives.openPhase',
  description:
    'Open the next phase once every earlier work package is merged, finished or dropped; its work packages start. With refine, the AI first rewrites the work packages not started on the merged code, and confirming that draft opens the phase',
  input: openInitiativePhaseRequestSchema,
  output: initiativeDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/initiatives/:id/phases/:phase/open' },
});

export const rebreakdownInitiativeOp = defineOperationContract({
  ...common,
  ...byId,
  id: 'initiatives.rebreakdown',
  title: 'op.initiatives.rebreakdown',
  description: 'Have the AI break the requirement down again, with feedback on the draft, before it is confirmed',
  input: rebreakdownInitiativeRequestSchema,
  output: initiativeDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/initiatives/:id/rebreakdown' },
});

export const refineInitiativeOp = defineOperationContract({
  ...common,
  ...byId,
  id: 'initiatives.refine',
  title: 'op.initiatives.refine',
  description:
    'Have the AI rewrite the work packages that have not started on the code merged so far; the user confirms the new draft',
  input: refineInitiativeRequestSchema,
  output: initiativeDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/initiatives/:id/refine' },
});

export const startInitiativeItemOp = defineOperationContract({
  ...common,
  ...byId,
  id: 'initiatives.startItem',
  title: 'op.initiatives.startItem',
  description: 'Start a work package that can start: after its start failed, or again after its task was cancelled',
  input: startInitiativeItemRequestSchema,
  output: initiativeDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/initiatives/:id/items/:key/start' },
});

export const confirmInitiativeItemMergedOp = defineOperationContract({
  ...common,
  ...byId,
  id: 'initiatives.confirmMerged',
  title: 'op.initiatives.confirmMerged',
  description:
    'Mark a work package delivered as a pull request as merged; the user pulls the merge into the local base branch first',
  input: confirmInitiativeItemMergedRequestSchema,
  output: initiativeDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/initiatives/:id/items/:key/merged' },
});

export const dropInitiativeItemOp = defineOperationContract({
  ...common,
  ...byId,
  id: 'initiatives.dropItem',
  title: 'op.initiatives.dropItem',
  description: 'Do not do a work package; its dependents no longer wait for it',
  input: dropInitiativeItemRequestSchema,
  output: initiativeDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/initiatives/:id/items/:key/drop' },
});

export const deliverInitiativePhaseOp = defineOperationContract({
  ...common,
  ...byId,
  id: 'initiatives.deliverPhase',
  title: 'op.initiatives.deliverPhase',
  description:
    'Deliver every work package of a phase waiting for review, one after another: merge each locally (or finish reports); one that conflicts or fails stays in review and the others go on',
  input: deliverInitiativePhaseRequestSchema,
  output: deliverInitiativePhaseResponseSchema,
  risk: OperationRisk.Critical,
  http: { method: 'POST', path: '/initiatives/:id/phases/:phase/deliver' },
});

export const deleteInitiativeOp = defineOperationContract({
  ...common,
  ...byId,
  id: 'initiatives.delete',
  title: 'op.initiatives.delete',
  description: "Delete an initiative; its work packages' tasks stay as ordinary tasks",
  input: deleteInitiativeRequestSchema,
  output: z.void(),
  risk: OperationRisk.Critical,
  http: { method: 'DELETE', path: '/initiatives/:id' },
});
