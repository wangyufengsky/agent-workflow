import { z } from 'zod';
import {
  roleSchema,
  updateRoleRequestSchema,
  updateWorkflowRequestSchema,
  workflowSchema,
  workflowSummarySchema,
} from '../contracts/api/workflows.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

const byId = z.object({ id: z.string() });

export const listWorkflowsOp = defineOperationContract({
  id: 'workflows.list',
  title: 'op.workflows.list',
  description: 'Latest version of every workflow a task can be started with',
  input: z.object({}),
  output: z.object({ items: z.array(workflowSummarySchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/workflows' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Simple,
});

export const getWorkflowOp = defineOperationContract({
  id: 'workflows.get',
  title: 'op.workflows.get',
  description: 'One workflow version with its definition',
  input: byId,
  output: workflowSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/workflows/:id' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Simple,
});

export const updateWorkflowOp = defineOperationContract({
  id: 'workflows.update',
  title: 'op.workflows.update',
  description: 'Save a custom workflow as a new version; built-in workflows are read-only',
  input: updateWorkflowRequestSchema,
  output: workflowSchema,
  risk: OperationRisk.Write,
  http: { method: 'PUT', path: '/workflows/:id' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Pro,
});

export const listRolesOp = defineOperationContract({
  id: 'roles.list',
  title: 'op.roles.list',
  description: 'Roles that workflow steps are assigned to',
  input: z.object({}),
  output: z.object({ items: z.array(roleSchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/roles' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Simple,
});

export const updateRoleOp = defineOperationContract({
  id: 'roles.update',
  title: 'op.roles.update',
  description: "Change a custom role's name, prompt or model; built-in roles are read-only",
  input: updateRoleRequestSchema,
  output: roleSchema,
  risk: OperationRisk.Write,
  http: { method: 'PUT', path: '/roles/:id' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Pro,
});
