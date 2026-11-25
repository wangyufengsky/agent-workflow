import { z } from 'zod';
import { contextDetailSchema } from '../contracts/api/context.ts';
import { InputRef } from '../enums/entity.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

const byId = z.object({ id: z.string() });

const contextRead = {
  input: byId,
  output: contextDetailSchema,
  risk: OperationRisk.Read,
  expose: { palette: false, assistant: false },
  credentialFields: [],
  mode: UiMode.Simple,
} as const;
export const getAttemptContextOp = defineOperationContract({
  ...contextRead,
  id: 'attempts.context',
  refs: { id: InputRef.Attempt },
  title: 'op.attempts.context',
  description: 'Inspect the context of one attempt',
  http: { method: 'GET', path: '/attempts/:id/context' },
});
export const getAssistantContextOp = defineOperationContract({
  ...contextRead,
  id: 'assistant.context',
  title: 'op.assistant.context',
  description: 'Inspect the current context of one assistant conversation',
  http: { method: 'GET', path: '/assistant/conversations/:id/context' },
});
