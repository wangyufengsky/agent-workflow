import { z } from 'zod';
import { changeRequestReasonSchema, deliveryStatusSchema, deliveryStrategySchema } from '../../enums/git.ts';
import { errorInfoSchema } from '../../errors/codes.ts';

/** One merge or pull request of a task (10 §deliveries). */
export const deliverySchema = z.object({
  id: z.string(),
  strategy: deliveryStrategySchema,
  targetBranch: z.string(),
  status: deliveryStatusSchema,
  /** Tip of the target branch after a local merge. */
  commitSha: z.string().nullable(),
  prUrl: z.string().nullable(),
  /** Files that conflicted; the merge was aborted. */
  conflictFiles: z.array(z.string()).nullable(),
  error: errorInfoSchema.nullable(),
  createdAt: z.number(),
  finishedAt: z.number().nullable(),
});
export type DeliveryDTO = z.infer<typeof deliverySchema>;

/** `POST /tasks/:id/deliver` (11 §5.3). */
export const deliverRequestSchema = z.object({
  id: z.string(),
  strategy: deliveryStrategySchema,
  /** Default: the task's base branch. */
  targetBranch: z.string().min(1).optional(),
  /** Pull request title and description; default: the task title and the result summary. */
  pr: z.object({ title: z.string().trim().min(1), body: z.string() }).optional(),
});
export type DeliverRequest = z.infer<typeof deliverRequestSchema>;

/** `POST /tasks/:id/request-changes` (11 §5): feedback is required when the user asks for changes. */
export const requestChangesSchema = z.object({
  id: z.string(),
  reason: changeRequestReasonSchema,
  feedback: z.string().trim().min(1).optional(),
});
export type RequestChangesRequest = z.infer<typeof requestChangesSchema>;
