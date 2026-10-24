import { z } from 'zod';
import {
  confirmInitiativeItemMergedRequestSchema,
  confirmInitiativeRequestSchema,
  createInitiativeRequestSchema,
  deleteInitiativeRequestSchema,
  deliverInitiativePhaseRequestSchema,
  deliverInitiativePhaseResponseSchema,
  dropInitiativeItemRequestSchema,
  getInitiativeRequestSchema,
  initiativeDetailSchema,
  initiativeSummarySchema,
  initiativeTemplateSchema,
  listInitiativesQuerySchema,
  openInitiativePhaseRequestSchema,
  saveInitiativeDraftRequestSchema,
  startInitiativeItemRequestSchema,
} from '../contracts/api/initiatives.ts';
import { InputRef } from '../enums/entity.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

// Initiatives are a simple-mode feature (34 §10). The assistant and the palette get them together with their pages.
const common = { expose: { palette: false, assistant: false }, credentialFields: [], mode: UiMode.Simple } as const;

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
    "Start an initiative from a composition template: each work package becomes an ordinary task in its phase, using the template's workflows; {{requirement}} is replaced by the requirement",
  input: createInitiativeRequestSchema,
  output: initiativeDetailSchema,
  refs: { projectId: InputRef.Project, attachmentIds: InputRef.Attachment },
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/initiatives', status: 201 },
});

export const getInitiativeOp = defineOperationContract({
  ...common,
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
  id: 'initiatives.openPhase',
  title: 'op.initiatives.openPhase',
  description:
    'Open the next phase once every earlier work package is merged, finished or dropped; its work packages start',
  input: openInitiativePhaseRequestSchema,
  output: initiativeDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/initiatives/:id/phases/:phase/open' },
});

export const startInitiativeItemOp = defineOperationContract({
  ...common,
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
  id: 'initiatives.delete',
  title: 'op.initiatives.delete',
  description: "Delete an initiative; its work packages' tasks stay as ordinary tasks",
  input: deleteInitiativeRequestSchema,
  output: z.void(),
  risk: OperationRisk.Critical,
  http: { method: 'DELETE', path: '/initiatives/:id' },
});
