import { z } from 'zod';
import {
  deliverRequestSchema,
  requestChangesSchema,
  reviewCommentsSchema,
  reviseFromReviewSchema,
} from '../contracts/api/delivery.ts';
import { diffSchema, fileDiffSchema } from '../contracts/api/git.ts';
import {
  createTaskRequestSchema,
  listTasksQuerySchema,
  nodeDetailSchema,
  planSchema,
  planSummarySchema,
  saveDraftPlanRequestSchema,
  taskDetailSchema,
  taskEventSchema,
  taskSummarySchema,
} from '../contracts/api/tasks.ts';
import { EntityKind, InputRef } from '../enums/entity.ts';
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
  description:
    'Tasks, most recently updated first, optionally filtered by project, status or display group, a page at a time',
  input: listTasksQuerySchema,
  output: z.object({ items: z.array(taskSummarySchema), nextCursor: z.string().nullable() }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/tasks' },
});

export const createTaskOp = defineOperationContract({
  ...common,
  id: 'tasks.create',
  refs: { projectId: InputRef.Project, workflowId: InputRef.Workflow },
  title: 'op.tasks.create',
  description: 'Create a development task in a project with a workflow and start it (unless start is false)',
  input: createTaskRequestSchema,
  output: taskDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks', status: 201 },
  // The palette opens the home page's start form with it (14 §2.1).
  expose: { palette: true, assistant: true },
  produces: { kind: EntityKind.Task, ref: (task) => ({ id: task.id, title: `${task.key} · ${task.title}` }) },
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
  refs: { id: InputRef.Task },
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
  refs: { id: InputRef.Task },
  title: 'op.tasks.retry',
  description: 'Continue a failed task from the phase it failed in, optionally with a note for its failed steps',
  input: z.object({ id: z.string(), feedback: z.string().trim().min(1).optional() }),
  output: taskDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks/:id/retry' },
});

export const updateCheckCommandOp = defineOperationContract({
  ...common,
  id: 'tasks.updateCheckCommand',
  refs: { id: InputRef.Task },
  title: 'op.tasks.updateCheckCommand',
  description:
    "Replace the check command a failed task's step failed on in the task's unfinished steps (and the project's check command when updateProject), then check the submitted result again",
  input: z.object({ id: z.string(), command: z.string().trim().min(1), updateProject: z.boolean() }),
  output: taskDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks/:id/check-command' },
});

export const skipCheckOp = defineOperationContract({
  ...common,
  id: 'tasks.skipCheck',
  refs: { id: InputRef.Task },
  title: 'op.tasks.skipCheck',
  description:
    "Skip the check the app's environment could not run (a check command, or the page check when the preview never started) in the task's unfinished steps and go on; the result is marked unverified",
  input: byId,
  output: taskDetailSchema,
  risk: OperationRisk.Critical,
  http: { method: 'POST', path: '/tasks/:id/skip-check' },
});

export const cancelTaskOp = defineOperationContract({
  ...common,
  id: 'tasks.cancel',
  refs: { id: InputRef.Task },
  title: 'op.tasks.cancel',
  description: 'Cancel a task: stop its AI sessions and remove its worktree (and branch unless keepBranch)',
  input: z.object({ id: z.string(), keepBranch: z.boolean().optional() }),
  output: taskDetailSchema,
  risk: OperationRisk.Critical,
  http: { method: 'POST', path: '/tasks/:id/cancel' },
});

export const pauseTaskOp = defineOperationContract({
  ...common,
  id: 'tasks.pause',
  refs: { id: InputRef.Task },
  title: 'op.tasks.pause',
  description: 'Pause a running task: no new steps start, steps already working finish; its plan can then be adjusted',
  input: byId,
  output: taskDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks/:id/pause' },
  mode: UiMode.Pro,
});

export const resumeTaskOp = defineOperationContract({
  ...common,
  id: 'tasks.resume',
  refs: { id: InputRef.Task },
  title: 'op.tasks.resume',
  description: 'Resume a paused task; an adjusted plan that was not confirmed is discarded',
  input: byId,
  output: taskDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks/:id/resume' },
  mode: UiMode.Pro,
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
  refs: { id: InputRef.Task },
  title: 'op.tasks.confirmPlan',
  description:
    'Confirm the plan waiting for review and start running its steps, or (paused task) apply the adjusted plan',
  input: z.object({ id: z.string(), version: z.number().int().min(1) }),
  output: taskDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks/:id/plan/confirm' },
});

export const saveDraftPlanOp = defineOperationContract({
  ...common,
  id: 'plans.saveDraft',
  refs: { id: InputRef.Task },
  title: 'op.plans.saveDraft',
  description:
    'Save a user-edited plan as a new draft version: any change while the plan waits for review; only steps that have not started while the task is paused',
  input: saveDraftPlanRequestSchema,
  output: planSchema,
  risk: OperationRisk.Write,
  http: { method: 'PUT', path: '/tasks/:id/plan/draft' },
  mode: UiMode.Pro,
});

export const replanOp = defineOperationContract({
  ...common,
  id: 'tasks.replan',
  refs: { id: InputRef.Task },
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
  refs: { id: InputRef.Task, nodeId: InputRef.Node },
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
  refs: { id: InputRef.Task, nodeId: InputRef.Node },
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
  refs: { id: InputRef.Task, nodeId: InputRef.Node },
  title: 'op.nodes.retry',
  description: 'Give a failed step a fresh attempt budget, optionally with feedback for its next attempt',
  input: z.object({ id: z.string(), nodeId: z.string(), feedback: z.string().trim().min(1).optional() }),
  output: nodeDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks/:id/nodes/:nodeId/retry' },
  mode: UiMode.Pro,
});

export const skipNodeOp = defineOperationContract({
  ...common,
  id: 'nodes.skip',
  refs: { id: InputRef.Task, nodeId: InputRef.Node },
  title: 'op.nodes.skip',
  description: 'Skip a step that has not started or has failed; steps depending on it go on as if it were done',
  input: byNode,
  output: nodeDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks/:id/nodes/:nodeId/skip' },
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

export const deliverTaskOp = defineOperationContract({
  ...common,
  id: 'tasks.deliver',
  refs: { id: InputRef.Task },
  title: 'op.tasks.deliver',
  description:
    'Deliver a task waiting for review: merge its branch locally (squash / merge / rebase), push it and open a pull request, or (report workflows) finish it',
  input: deliverRequestSchema,
  output: taskDetailSchema,
  risk: OperationRisk.Critical,
  http: { method: 'POST', path: '/tasks/:id/deliver' },
});

export const requestChangesOp = defineOperationContract({
  ...common,
  id: 'tasks.requestChanges',
  refs: { id: InputRef.Task },
  title: 'op.tasks.requestChanges',
  description:
    'Send a task waiting for review back to the AI: a new step makes the requested changes (reason user) or resolves the merge conflict (reason conflict)',
  input: requestChangesSchema,
  output: taskDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks/:id/request-changes' },
  // A preview tab is the user's own: the assistant has none to attach.
  assistantOmit: ['page'],
});

export const reviewCommentsOp = defineOperationContract({
  ...common,
  id: 'tasks.reviewComments',
  refs: { id: InputRef.Task },
  title: 'op.tasks.reviewComments',
  description:
    'Fetch the review comments of the open pull request a task was delivered as: unresolved review threads and general comments, live from the hosting platform',
  input: byId,
  output: reviewCommentsSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/tasks/:id/review-comments' },
});

export const reviseFromReviewOp = defineOperationContract({
  ...common,
  id: 'tasks.reviseFromReview',
  refs: { id: InputRef.Task },
  title: 'op.tasks.reviseFromReview',
  description:
    'Send a task delivered as a pull request back to the AI to address the chosen review comments (ids from tasks.reviewComments) on its branch; it returns to review, and the user pushes the changes to the same pull request with tasks.deliver',
  input: reviseFromReviewSchema,
  output: taskDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks/:id/review-feedback' },
});
