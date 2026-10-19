import { z } from 'zod';
import { environmentSchema, healthSchema } from '../contracts/api/system.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

export const getHealthOp = defineOperationContract({
  id: 'system.health',
  title: 'op.system.health',
  description: 'Backend liveness and version',
  input: z.object({}),
  output: healthSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/system/health' },
  expose: { palette: false, assistant: false },
  credentialFields: [],
  mode: UiMode.Simple,
});

export const getEnvironmentOp = defineOperationContract({
  id: 'system.environment',
  title: 'op.system.environment',
  description: 'Whether git, opencode and a model are available',
  input: z.object({}),
  output: environmentSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/system/environment' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Simple,
});

export const recheckEnvironmentOp = defineOperationContract({
  id: 'system.recheckEnvironment',
  title: 'op.system.recheckEnvironment',
  description: 'Detect git and opencode again, e.g. after installing opencode',
  input: z.object({}),
  output: environmentSchema,
  risk: OperationRisk.Read,
  http: { method: 'POST', path: '/system/environment/recheck' },
  expose: { palette: true, assistant: true },
  credentialFields: [],
  mode: UiMode.Simple,
});
