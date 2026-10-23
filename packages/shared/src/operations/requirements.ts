import { z } from 'zod';
import { replaceRequirementsSchema, taskRequirementsSchema } from '../contracts/api/requirements.ts';
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
