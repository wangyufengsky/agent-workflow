import { z } from 'zod';
import { agentsMdSchema, startAgentsMdTaskRequestSchema } from '../contracts/api/agents-md.ts';
import { setProjectDbConnectionsRequestSchema } from '../contracts/api/databases.ts';
import {
  createProjectRequestSchema,
  gitInitPreviewSchema,
  projectDetailSchema,
  projectSchema,
  setHostingRequestSchema,
  updateProjectRequestSchema,
} from '../contracts/api/projects.ts';
import { taskDetailSchema } from '../contracts/api/tasks.ts';
import { EntityKind, InputRef } from '../enums/entity.ts';
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
  produces: { kind: EntityKind.Project, ref: (project) => ({ id: project.id, title: project.name }) },
});

export const previewGitInitOp = defineOperationContract({
  id: 'projects.previewGitInit',
  title: 'op.projects.previewGitInit',
  description: 'What putting a directory that is in no Git repository under Git would commit and ignore',
  input: z.object({ repoPath: z.string().min(1) }),
  output: gitInitPreviewSchema,
  risk: OperationRisk.Read,
  http: { method: 'POST', path: '/projects/git-init/preview' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Simple,
});

export const initGitOp = defineOperationContract({
  id: 'projects.initGit',
  title: 'op.projects.initGit',
  description:
    'Put a directory that is in no Git repository under Git (init on main, .gitignore, first commit) and add it',
  input: createProjectRequestSchema,
  output: projectDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/projects/git-init', status: 201 },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Simple,
  produces: { kind: EntityKind.Project, ref: (project) => ({ id: project.id, title: project.name }) },
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
  refs: { id: InputRef.Project },
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
  refs: { id: InputRef.Project },
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

export const setProjectHostingOp = defineOperationContract({
  id: 'projects.setHosting',
  title: 'op.projects.setHosting',
  description: 'Bind the project to its GitHub or GitLab repository with an access token (verified first)',
  input: setHostingRequestSchema,
  output: projectDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'PUT', path: '/projects/:id/hosting' },
  expose: { palette: false, assistant: true },
  credentialFields: ['token'],
  mode: UiMode.Simple,
});

export const clearProjectHostingOp = defineOperationContract({
  id: 'projects.clearHosting',
  refs: { id: InputRef.Project },
  title: 'op.projects.clearHosting',
  description: 'Unbind the project from its hosting repository and delete the stored token',
  input: byId,
  output: projectDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'DELETE', path: '/projects/:id/hosting' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Simple,
});

export const setProjectDbConnectionsOp = defineOperationContract({
  id: 'projects.setDbConnections',
  refs: { id: InputRef.Project, connectionIds: InputRef.DbConnection },
  title: 'op.projects.setDbConnections',
  description: "Choose the database connections the project's AI sessions may query read-only",
  input: setProjectDbConnectionsRequestSchema,
  output: projectDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'PUT', path: '/projects/:id/db-connections' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Pro,
});

export const removeProjectAllowedBashOp = defineOperationContract({
  id: 'projects.removeAllowedBash',
  refs: { id: InputRef.Project },
  title: 'op.projects.removeAllowedBash',
  description: "Revoke a bash pattern the user always allowed for the project's AI sessions; later sessions ask again",
  input: z.object({ id: z.string(), pattern: z.string().min(1) }),
  output: projectDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'DELETE', path: '/projects/:id/allowed-bash' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Pro,
});

export const getAgentsMdOp = defineOperationContract({
  id: 'projects.agentsMd',
  title: 'op.projects.agentsMd',
  description:
    "The project's root AGENTS.md on its default branch, the Agent Workflow rules a task would add, and an AGENTS.md task in progress",
  input: byId,
  output: agentsMdSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects/:id/agents-md' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Simple,
});

export const startAgentsMdTaskOp = defineOperationContract({
  id: 'projects.startAgentsMdTask',
  refs: { id: InputRef.Project },
  title: 'op.projects.startAgentsMdTask',
  description:
    "Start a task in which the AI writes the project's AGENTS.md (generates it, or supplements the existing one) in its own worktree; the user merges the result",
  input: startAgentsMdTaskRequestSchema,
  output: taskDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/projects/:id/agents-md/task', status: 201 },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Simple,
  produces: { kind: EntityKind.Task, ref: (task) => ({ id: task.id, title: `${task.key} · ${task.title}` }) },
});
