import { z } from 'zod';
import {
  decideRequirementSchema,
  replaceRequirementsSchema,
  taskRequirementsSchema,
} from '../contracts/api/requirements.ts';
import { taskDetailSchema } from '../contracts/api/tasks.ts';
import { InputRef } from '../enums/entity.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

// The assistant can read and propose a checklist (31 §2.1); the user's own verdicts are UI only (11 §14.2).
const common = { expose: { palette: false, assistant: true }, credentialFields: [], mode: UiMode.Simple } as const;

export const getRequirementsOp = defineOperationContract({
  ...common,
  id: 'requirements.get',
  refs: { id: InputRef.Task },
  title: 'op.requirements.get',
  description: "A task's acceptance checklist: the current version, each item's verification and state",
  input: z.object({ id: z.string() }),
  output: taskRequirementsSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/tasks/:id/requirements' },
});

export const replaceRequirementsOp = defineOperationContract({
  ...common,
  id: 'requirements.replace',
  refs: { id: InputRef.Task },
  title: 'op.requirements.replace',
  description:
    "Save a task's whole acceptance checklist as a new version (keep an item's id to keep the item); only while the task is a draft, waits for plan confirmation or is in review",
  input: replaceRequirementsSchema,
  output: taskRequirementsSchema,
  risk: OperationRisk.Write,
  http: { method: 'PUT', path: '/tasks/:id/requirements' },
});

export const decideRequirementOp = defineOperationContract({
  ...common,
  // The user's own verdict on the result: never the assistant's, nor a palette shortcut (11 §14.2).
  expose: { palette: false, assistant: false },
  id: 'requirements.decide',
  refs: { id: InputRef.Task },
  title: 'op.requirements.decide',
  description: 'Pass, fail or accept as not done one item of the checklist of a task in review, with a note',
  input: decideRequirementSchema,
  output: taskRequirementsSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks/:id/requirements/:itemId/decisions' },
});

export const reverifyRequirementsOp = defineOperationContract({
  ...common,
  id: 'tasks.reverifyRequirements',
  refs: { id: InputRef.Task },
  title: 'op.tasks.reverifyRequirements',
  description: 'Verify a task in review against its current acceptance checklist again: one more read-only step',
  input: z.object({ id: z.string() }),
  output: taskDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks/:id/requirements/reverify' },
});
