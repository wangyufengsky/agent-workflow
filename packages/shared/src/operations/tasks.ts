import { z } from 'zod';
import { diffSchema, fileDiffSchema } from '../contracts/api/git.ts';
import {
  createTaskRequestSchema,
  listTasksQuerySchema,
  nodeDetailSchema,
  planSchema,
  planSummarySchema,
  taskDetailSchema,
  taskEventSchema,
  taskSummarySchema,
} from '../contracts/api/tasks.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

const byId = z.object({ id: z.string() });
const byNode = z.object({ id: z.string(), nodeId: z.string() });
const common = { expose: { palette: false, assistant: true }, credentialFields: [], mode: UiMode.Simple } as const;

export const listTasksOp = defineOperationContract({
  ...common,
  id: 'tasks.list',
  title: 'op.tasks.list',
  description: 'Tasks, most recently updated first, optionally filtered by project, status or display group',
  input: listTasksQuerySchema,
  output: z.object({ items: z.array(taskSummarySchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/tasks' },
});

export const createTaskOp = defineOperationContract({
  ...common,
  id: 'tasks.create',
  title: 'op.tasks.create',
  description: 'Create a development task in a project with a workflow and start it (unless start is false)',
  input: createTaskRequestSchema,
  output: taskDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks', status: 201 },
});

export const getTaskOp = defineOperationContract({
  ...common,
  id: 'tasks.get',
  title: 'op.tasks.get',
  description: 'A task with its plan, steps, active AI sessions, open items and result',
  input: byId,
  output: taskDetailSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/tasks/:id' },
});

export const getTaskTimelineOp = defineOperationContract({
  ...common,
  id: 'tasks.timeline',
  title: 'op.tasks.timeline',
  description: 'State changes of a task and its steps, plans and attempts, oldest first',
  input: z.object({ id: z.string(), afterId: z.coerce.number().int().min(0).default(0) }),
  output: z.object({ items: z.array(taskEventSchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/tasks/:id/timeline' },
});

export const startTaskOp = defineOperationContract({
  ...common,
  id: 'tasks.start',
  title: 'op.tasks.start',
  description: 'Start a draft task',
  input: byId,
  output: taskDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks/:id/start' },
});

export const retryTaskOp = defineOperationContract({
  ...common,
  id: 'tasks.retry',
  title: 'op.tasks.retry',
  description: 'Continue a failed task from the phase it failed in',
  input: byId,
  output: taskDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks/:id/retry' },
});

export const cancelTaskOp = defineOperationContract({
  ...common,
  id: 'tasks.cancel',
  title: 'op.tasks.cancel',
  description: 'Cancel a task: stop its AI sessions and remove its worktree (and branch unless keepBranch)',
  input: z.object({ id: z.string(), keepBranch: z.boolean().optional() }),
  output: taskDetailSchema,
  risk: OperationRisk.Critical,
  http: { method: 'POST', path: '/tasks/:id/cancel' },
});

export const listPlansOp = defineOperationContract({
  ...common,
  id: 'plans.list',
  title: 'op.plans.list',
  description: 'Plan versions of a task, newest first',
  input: byId,
  output: z.object({ items: z.array(planSummarySchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/tasks/:id/plans' },
});

export const getPlanOp = defineOperationContract({
  ...common,
  id: 'plans.get',
  title: 'op.plans.get',
  description: 'One plan version of a task with its steps',
  input: z.object({ id: z.string(), version: z.coerce.number().int().min(1) }),
  output: planSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/tasks/:id/plans/:version' },
});

export const confirmPlanOp = defineOperationContract({
  ...common,
  id: 'tasks.confirmPlan',
  title: 'op.tasks.confirmPlan',
  description: 'Confirm the plan waiting for review and start running its steps',
  input: z.object({ id: z.string(), version: z.number().int().min(1) }),
  output: taskDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks/:id/plan/confirm' },
});

export const replanOp = defineOperationContract({
  ...common,
  id: 'tasks.replan',
  title: 'op.tasks.replan',
  description: 'Send feedback on the plan waiting for review; the planner revises it in the same session',
  input: z.object({ id: z.string(), feedback: z.string().trim().min(1) }),
  output: taskDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks/:id/plan/replan' },
});

export const getNodeOp = defineOperationContract({
  ...common,
  id: 'nodes.get',
  title: 'op.nodes.get',
  description: 'One step of a task: definition, result, check results and attempts',
  input: byNode,
  output: nodeDetailSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/tasks/:id/nodes/:nodeId' },
});

export const acceptNodeOp = defineOperationContract({
  ...common,
  id: 'nodes.accept',
  title: 'op.nodes.accept',
  description: 'Accept a step that waits for manual acceptance',
  input: byNode,
  output: nodeDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks/:id/nodes/:nodeId/accept' },
});

export const rejectNodeOp = defineOperationContract({
  ...common,
  id: 'nodes.reject',
  title: 'op.nodes.reject',
  description: 'Reject a step that waits for manual acceptance; the feedback goes to its next attempt',
  input: z.object({ id: z.string(), nodeId: z.string(), feedback: z.string().trim().min(1) }),
  output: nodeDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks/:id/nodes/:nodeId/reject' },
});

export const retryNodeOp = defineOperationContract({
  ...common,
  id: 'nodes.retry',
  title: 'op.nodes.retry',
  description: 'Give a failed step a fresh attempt budget, optionally with feedback for its next attempt',
  input: z.object({ id: z.string(), nodeId: z.string(), feedback: z.string().trim().min(1).optional() }),
  output: nodeDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks/:id/nodes/:nodeId/retry' },
  mode: UiMode.Pro,
});

export const taskDiffOp = defineOperationContract({
  ...common,
  id: 'tasks.diff',
  title: 'op.tasks.diff',
  description: 'Files the task changed (committed or not) against the merge base of its branch and the target branch',
  input: byId,
  output: diffSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/tasks/:id/diff' },
});

export const taskDiffFileOp = defineOperationContract({
  ...common,
  id: 'tasks.diffFile',
  title: 'op.tasks.diffFile',
  description: 'Unified diff of one file the task changed',
  input: z.object({ id: z.string(), path: z.string().min(1) }),
  output: fileDiffSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/tasks/:id/diff/file' },
});

export const nodeDiffOp = defineOperationContract({
  ...common,
  id: 'nodes.diff',
  title: 'op.nodes.diff',
  description: "Files changed by a step's commit",
  input: byNode,
  output: diffSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/tasks/:id/nodes/:nodeId/diff' },
});

export const nodeDiffFileOp = defineOperationContract({
  ...common,
  id: 'nodes.diffFile',
  title: 'op.nodes.diffFile',
  description: "Unified diff of one file in a step's commit",
  input: z.object({ id: z.string(), nodeId: z.string(), path: z.string().min(1) }),
  output: fileDiffSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/tasks/:id/nodes/:nodeId/diff/file' },
});
