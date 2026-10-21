import { z } from 'zod';
import { renderBatchRequirement } from '../../batch/batch.ts';
import { BATCH_TARGET_PLACEHOLDER } from '../../constants/app.ts';
import {
  BATCH_TARGET_MAX_CHARS,
  BATCH_TARGETS_MAX,
  LIST_PAGE_DEFAULT,
  LIST_PAGE_MAX,
  REQUIREMENT_MAX_CHARS,
} from '../../constants/limits.ts';
import { batchDeliveryOutcomeSchema } from '../../enums/batch.ts';
import { localMergeStrategySchema } from '../../enums/git.ts';
import { taskDisplayGroupSchema } from '../../enums/task.ts';
import { workflowDeliverableSchema } from '../../enums/workflow.ts';
import { errorInfoSchema } from '../../errors/codes.ts';
import { deliverySchema } from './delivery.ts';
import { taskSummarySchema } from './tasks.ts';

/** One target: a path, a module or class name — any single line of text (20 §2, D85 ③). */
const targetSchema = z
  .string()
  .trim()
  .min(1)
  .max(BATCH_TARGET_MAX_CHARS)
  .refine((target) => !/[\r\n]/.test(target), 'a target is a single line');

/** `POST /batches` (20 §7): one fixed workflow, one task per target. */
export const createBatchRequestSchema = z
  .object({
    projectId: z.string(),
    /** A specific version of a fixed workflow. */
    workflowId: z.string(),
    /** Each task's requirement, with `{{target}}` replaced by its target. */
    requirementTemplate: z
      .string()
      .trim()
      .min(1)
      .max(REQUIREMENT_MAX_CHARS)
      .refine((template) => template.includes(BATCH_TARGET_PLACEHOLDER), `must contain ${BATCH_TARGET_PLACEHOLDER}`),
    targets: z
      .array(targetSchema)
      .min(1)
      .max(BATCH_TARGETS_MAX)
      .refine((targets) => new Set(targets).size === targets.length, 'targets must be unique'),
    /** Defaults to the project's default branch; the same for every task. */
    baseBranch: z.string().min(1).optional(),
  })
  .superRefine(({ requirementTemplate, targets }, ctx) => {
    targets.forEach((target, i) => {
      if (renderBatchRequirement(requirementTemplate, target).length > REQUIREMENT_MAX_CHARS) {
        ctx.addIssue({
          code: 'custom',
          path: ['targets', i],
          message: `the requirement for this target exceeds ${REQUIREMENT_MAX_CHARS} characters`,
        });
      }
    });
  });
export type CreateBatchRequest = z.infer<typeof createBatchRequestSchema>;

export const listBatchesQuerySchema = z.object({
  projectId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(LIST_PAGE_MAX).default(LIST_PAGE_DEFAULT),
  /** The `seq` of the previous page's last batch. */
  cursor: z
    .string()
    .regex(/^[1-9]\d*$/)
    .optional(),
});
export type ListBatchesQuery = z.infer<typeof listBatchesQuerySchema>;

/** `BatchSummaryDTO` (20 §7): the batch and its progress, derived from its tasks. */
export const batchSummarySchema = z.object({
  id: z.string(),
  /** `B-<seq>` */
  key: z.string(),
  title: z.string(),
  project: z.object({ id: z.string(), name: z.string() }),
  workflow: z.object({ id: z.string(), key: z.string(), name: z.string(), deliverable: workflowDeliverableSchema }),
  total: z.number(),
  /** `batchCounts` of the tasks' display groups. */
  counts: z.array(z.object({ group: taskDisplayGroupSchema, count: z.number() })),
  /** Tasks in a terminal state; the batch is finished when all are. */
  ended: z.number(),
  createdAt: z.number(),
});
export type BatchSummaryDTO = z.infer<typeof batchSummarySchema>;

export const batchItemSchema = z.object({
  position: z.number(),
  target: z.string(),
  task: taskSummarySchema,
  /** The task's current round's latest delivery, as `TaskDetailDTO.lastDelivery`. */
  lastDelivery: deliverySchema.nullable(),
});
export type BatchItemDTO = z.infer<typeof batchItemSchema>;

export const batchDetailSchema = batchSummarySchema.extend({
  requirementTemplate: z.string(),
  baseBranch: z.string(),
  /** In target order. */
  items: z.array(batchItemSchema),
});
export type BatchDetailDTO = z.infer<typeof batchDetailSchema>;

/** `POST /batches/:id/deliver` (20 §5): reports finish with `report_only`, code is merged with this strategy. */
export const deliverBatchRequestSchema = z.object({
  id: z.string(),
  /** Default: the setting `delivery.defaultStrategy`. */
  strategy: localMergeStrategySchema.optional(),
});
export type DeliverBatchRequest = z.infer<typeof deliverBatchRequestSchema>;

export const batchDeliveryResultSchema = z.object({
  taskId: z.string(),
  taskKey: z.string(),
  target: z.string(),
  outcome: batchDeliveryOutcomeSchema,
  /** Why a `failed` or `conflict` task was not delivered. */
  error: errorInfoSchema.nullable(),
});
export type BatchDeliveryResultDTO = z.infer<typeof batchDeliveryResultSchema>;

export const deliverBatchResponseSchema = z.object({
  batch: batchDetailSchema,
  /** One per task that was waiting to be delivered, in target order. */
  outcomes: z.array(batchDeliveryResultSchema),
});
export type DeliverBatchResponse = z.infer<typeof deliverBatchResponseSchema>;
