import { z } from 'zod';
import { RUNTIME_LOG_TAIL_DEFAULT, RUNTIME_LOG_TAIL_MAX } from '../constants/limits.ts';
import {
  environmentSchema,
  healthSchema,
  mcpToolInfoSchema,
  runtimeLogsSchema,
  runtimeSchema,
} from '../contracts/api/system.ts';
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
  description: 'Detect git and opencode again, e.g. after installing opencode; a newly usable opencode is started',
  input: z.object({}),
  output: environmentSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/system/environment/recheck' },
  expose: { palette: true, assistant: true },
  credentialFields: [],
  mode: UiMode.Simple,
});

export const getRuntimeOp = defineOperationContract({
  id: 'system.runtime',
  title: 'op.system.runtime',
  description: 'State of the hosted opencode server',
  input: z.object({}),
  output: runtimeSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/system/runtime' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Pro,
});

export const restartRuntimeOp = defineOperationContract({
  id: 'system.restartRuntime',
  title: 'op.system.restartRuntime',
  description: 'Restart the hosted opencode server; running AI sessions are interrupted and can be retried',
  input: z.object({}),
  output: runtimeSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/system/runtime/restart' },
  expose: { palette: true, assistant: true },
  credentialFields: [],
  mode: UiMode.Pro,
});

export const getRuntimeLogsOp = defineOperationContract({
  id: 'system.runtimeLogs',
  title: 'op.system.runtimeLogs',
  description: 'The last lines of the hosted opencode log',
  input: z.object({ tail: z.coerce.number().int().min(1).max(RUNTIME_LOG_TAIL_MAX).default(RUNTIME_LOG_TAIL_DEFAULT) }),
  output: runtimeLogsSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/system/runtime/logs' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Pro,
});

export const listMcpToolsOp = defineOperationContract({
  id: 'system.mcpTools',
  title: 'op.system.mcpTools',
  description: 'Tools of the execution MCP that AI sessions use: name, description, input schema and attempt kinds',
  input: z.object({}),
  output: z.object({ items: z.array(mcpToolInfoSchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/mcp/tools' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Pro,
});
