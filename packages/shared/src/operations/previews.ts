import { z } from 'zod';
import { previewSchema, previewTrialSchema } from '../contracts/api/previews.ts';
import { InputRef } from '../enums/entity.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

// The assistant gets previews in B3 (29 §9).
const common = { expose: { palette: false, assistant: false }, credentialFields: [], mode: UiMode.Simple } as const;
const byTask = z.object({ taskId: z.string() });

export const getPreviewOp = defineOperationContract({
  ...common,
  id: 'previews.get',
  title: 'op.previews.get',
  description: "The task's page preview: whether its dev server runs, its address, the end of its log",
  input: byTask,
  output: previewSchema,
  refs: { taskId: InputRef.Task },
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/tasks/:taskId/preview' },
});

export const startPreviewOp = defineOperationContract({
  ...common,
  id: 'previews.start',
  title: 'op.previews.start',
  description:
    "Start the task's page preview (the project's dev server in the task worktree) and wait until it is ready",
  input: byTask,
  output: previewSchema,
  refs: { taskId: InputRef.Task },
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks/:taskId/preview/start' },
});

export const stopPreviewOp = defineOperationContract({
  ...common,
  id: 'previews.stop',
  title: 'op.previews.stop',
  description: "Stop the task's page preview",
  input: byTask,
  output: previewSchema,
  refs: { taskId: InputRef.Task },
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks/:taskId/preview/stop' },
});

export const trialPreviewOp = defineOperationContract({
  ...common,
  id: 'previews.trial',
  title: 'op.previews.trial',
  description: "Start the project's page preview once in its main workspace to check the settings, then stop it",
  input: z.object({ projectId: z.string() }),
  output: previewTrialSchema,
  refs: { projectId: InputRef.Project },
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/projects/:projectId/preview/trial' },
});
