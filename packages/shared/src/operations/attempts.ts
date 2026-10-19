import { z } from 'zod';
import { attemptSchema } from '../contracts/api/attempts.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

const byId = z.object({ id: z.string() });

export const getAttemptOp = defineOperationContract({
  id: 'attempts.get',
  title: 'op.attempts.get',
  description: 'One AI session attempt: status, model, error and token usage',
  input: byId,
  output: attemptSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/attempts/:id' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Simple,
});

export const abortAttemptOp = defineOperationContract({
  id: 'attempts.abort',
  title: 'op.attempts.abort',
  description: 'Stop a running AI session attempt',
  input: byId,
  output: attemptSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/attempts/:id/abort' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Pro,
});
