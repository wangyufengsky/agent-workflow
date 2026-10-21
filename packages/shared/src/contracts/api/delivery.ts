import { z } from 'zod';
import {
  changeRequestReasonSchema,
  deliveryStatusSchema,
  deliveryStrategySchema,
  reviewCommentKindSchema,
} from '../../enums/git.ts';
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

/** The task's latest pull request delivered by the app, across review rounds (21 §5). */
export const taskPullRequestSchema = z.object({
  url: z.string(),
  /** When the branch was last pushed to it (the delivery's finish). */
  pushedAt: z.number(),
});
export type TaskPullRequestDTO = z.infer<typeof taskPullRequestSchema>;

/** A review comment of the task's open pull request, as the platform has it now (21 §2.2). */
export const reviewCommentSchema = z.object({
  /** The platform's id of the thread, comment or review. */
  id: z.string(),
  kind: reviewCommentKindSchema,
  /** File and line a thread is on; null for general comments and threads on a whole file. */
  path: z.string().nullable(),
  line: z.number().nullable(),
  url: z.string(),
  /** Oldest first; a general comment has one. */
  messages: z.array(z.object({ author: z.string(), body: z.string(), createdAt: z.number() })),
  /** Unresolved threads, and general comments made after the last push (D87). */
  selectedByDefault: z.boolean(),
});
export type ReviewCommentDTO = z.infer<typeof reviewCommentSchema>;

/** `GET /tasks/:id/review-comments` (11 §5.4). */
export const reviewCommentsSchema = z.object({
  pullRequest: z.object({ url: z.string(), number: z.number() }),
  items: z.array(reviewCommentSchema),
});
export type ReviewCommentsDTO = z.infer<typeof reviewCommentsSchema>;

/** `POST /tasks/:id/review-feedback` (11 §5.4): the comments to address, by id, and the user's own note. */
export const reviseFromReviewSchema = z.object({
  id: z.string(),
  commentIds: z.array(z.string()).min(1),
  note: z.string().trim().min(1).optional(),
});
export type ReviseFromReviewRequest = z.infer<typeof reviseFromReviewSchema>;
