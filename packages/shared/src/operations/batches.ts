import { z } from 'zod';
import {
  batchDetailSchema,
  batchSummarySchema,
  createBatchRequestSchema,
  deliverBatchRequestSchema,
  deliverBatchResponseSchema,
  listBatchesQuerySchema,
} from '../contracts/api/batches.ts';
import { EntityKind } from '../enums/entity.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

// Batches are a simple-mode feature the assistant can use too (20 §8).
const common = { expose: { palette: false, assistant: true }, credentialFields: [], mode: UiMode.Simple } as const;

export const listBatchesOp = defineOperationContract({
  ...common,
  id: 'batches.list',
  title: 'op.batches.list',
  description: 'Batches of tasks (one fixed workflow run on several targets) with their progress, newest first',
  input: listBatchesQuerySchema,
  output: z.object({ items: z.array(batchSummarySchema), nextCursor: z.string().nullable() }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/batches' },
});

export const createBatchOp = defineOperationContract({
  ...common,
  id: 'batches.create',
  title: 'op.batches.create',
  description:
    'Run a fixed workflow (not an AI-planned one) on several targets at once: one task per target, each with its own branch and worktree; {{target}} in the requirement template is replaced by each target',
  input: createBatchRequestSchema,
  output: batchDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/batches', status: 201 },
  // The palette opens the new-batch page (20 §7).
  expose: { palette: true, assistant: true },
  produces: { kind: EntityKind.Batch, ref: (batch) => ({ id: batch.id, title: `${batch.key} · ${batch.title}` }) },
});

export const getBatchOp = defineOperationContract({
  ...common,
  id: 'batches.get',
  title: 'op.batches.get',
  description: "A batch with each target's task, its status and its latest delivery",
  input: z.object({ id: z.string() }),
  output: batchDetailSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/batches/:id' },
});

export const deliverBatchOp = defineOperationContract({
  ...common,
  id: 'batches.deliver',
  title: 'op.batches.deliver',
  description:
    'Deliver every task of a batch waiting for review, one after another: merge each locally (or finish reports); a task that conflicts or fails stays in review and the others go on',
  input: deliverBatchRequestSchema,
  output: deliverBatchResponseSchema,
  risk: OperationRisk.Critical,
  http: { method: 'POST', path: '/batches/:id/deliver' },
});
