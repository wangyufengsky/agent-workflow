import { z } from 'zod';
import {
  createProjectRequestSchema,
  projectDetailSchema,
  projectSchema,
  updateProjectRequestSchema,
} from '../contracts/api/projects.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

const byId = z.object({ id: z.string() });

export const listProjectsOp = defineOperationContract({
  id: 'projects.list',
  title: 'op.projects.list',
  description: 'List the local Git repositories added as projects',
  input: z.object({}),
  output: z.object({ items: z.array(projectSchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Simple,
});

export const createProjectOp = defineOperationContract({
  id: 'projects.create',
  title: 'op.projects.create',
  description: 'Add a local Git repository (its root directory) as a project',
  input: createProjectRequestSchema,
  output: projectDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/projects', status: 201 },
  expose: { palette: true, assistant: true },
  credentialFields: [],
  mode: UiMode.Simple,
});

export const getProjectOp = defineOperationContract({
  id: 'projects.get',
  title: 'op.projects.get',
  description: 'Project details including the hosting remote inferred from origin',
  input: byId,
  output: projectDetailSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects/:id' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Simple,
});

export const updateProjectOp = defineOperationContract({
  id: 'projects.update',
  title: 'op.projects.update',
  description: 'Rename a project or change its default branch or check command',
  input: updateProjectRequestSchema,
  output: projectDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'PATCH', path: '/projects/:id' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Simple,
});

export const deleteProjectOp = defineOperationContract({
  id: 'projects.delete',
  title: 'op.projects.delete',
  description: 'Remove a project from the app (the repository itself is untouched)',
  input: byId,
  output: z.void(),
  risk: OperationRisk.Critical,
  http: { method: 'DELETE', path: '/projects/:id' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Simple,
});
