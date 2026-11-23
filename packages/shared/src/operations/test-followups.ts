import { z } from 'zod';
import { InputRef } from '../enums/entity.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

const selection = z.object({ taskId: z.string(), executionIds: z.array(z.string().min(1)).min(1).max(100) });
const common = {
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Simple,
  refs: { taskId: InputRef.Task },
  risk: OperationRisk.Write,
  output: z.object({ taskId: z.string() }),
} as const;

export const functionalTestRepairOp = defineOperationContract({
  ...common,
  id: 'functionalTest.repair',
  title: 'op.functionalTest.repair',
  description:
    'Create or find a linked bugfix task from failed executions with their observed evidence and tested baseline.',
  input: selection,
  http: { method: 'POST', path: '/tasks/:taskId/functional-test/repair' },
});
export const functionalTestRerunOp = defineOperationContract({
  ...common,
  id: 'functionalTest.rerun',
  title: 'op.functionalTest.rerun',
  description:
    'Rerun the specified cases and their original assertions at a chosen commit or branch. Returns the linked functional test task.',
  input: selection.extend({ ref: z.string().trim().min(1).max(255) }),
  http: { method: 'POST', path: '/tasks/:taskId/functional-test/rerun' },
});
