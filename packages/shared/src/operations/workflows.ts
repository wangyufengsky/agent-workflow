import { z } from 'zod';
import {
  createRoleRequestSchema,
  createWorkflowRequestSchema,
  roleSchema,
  updateRoleRequestSchema,
  updateWorkflowRequestSchema,
  validateWorkflowRequestSchema,
  validateWorkflowResponseSchema,
  workflowSchema,
  workflowSummarySchema,
} from '../contracts/api/workflows.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

const byId = z.object({ id: z.string() });
const byKey = z.object({ key: z.string() });

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

export const listWorkflowVersionsOp = defineOperationContract({
  id: 'workflows.versions',
  title: 'op.workflows.versions',
  description: 'Every version of a workflow, newest first',
  input: byKey,
  output: z.object({ items: z.array(workflowSummarySchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/workflows/by-key/:key/versions' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Pro,
});

export const createWorkflowOp = defineOperationContract({
  id: 'workflows.create',
  title: 'op.workflows.create',
  description: 'Create a custom workflow, or copy an existing one (built-in workflows can only be changed as copies)',
  input: createWorkflowRequestSchema,
  output: workflowSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/workflows', status: 201 },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Pro,
});

export const validateWorkflowOp = defineOperationContract({
  id: 'workflows.validate',
  title: 'op.workflows.validate',
  description: 'Check a workflow definition without saving it',
  input: validateWorkflowRequestSchema,
  output: validateWorkflowResponseSchema,
  risk: OperationRisk.Read,
  http: { method: 'POST', path: '/workflows/validate' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Pro,
});

export const deleteWorkflowOp = defineOperationContract({
  id: 'workflows.delete',
  title: 'op.workflows.delete',
  description: 'Delete a custom workflow; versions used by tasks are kept for them but no longer listed',
  input: byKey,
  output: z.void(),
  risk: OperationRisk.Critical,
  http: { method: 'DELETE', path: '/workflows/by-key/:key' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Pro,
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

export const createRoleOp = defineOperationContract({
  id: 'roles.create',
  title: 'op.roles.create',
  description: 'Create a custom role, or copy an existing one (built-in roles can only be changed as copies)',
  input: createRoleRequestSchema,
  output: roleSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/roles', status: 201 },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Pro,
});

export const deleteRoleOp = defineOperationContract({
  id: 'roles.delete',
  title: 'op.roles.delete',
  description: 'Delete a custom role that no workflow and no task step uses',
  input: byId,
  output: z.void(),
  risk: OperationRisk.Critical,
  http: { method: 'DELETE', path: '/roles/:id' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Pro,
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
