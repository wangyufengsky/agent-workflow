import { z } from 'zod';
import { InboxKind, inboxStatusSchema, permissionDecisionSchema } from '../../enums/inbox.ts';
import { taskFailedPhaseSchema } from '../../enums/task.ts';
import { errorInfoSchema } from '../../errors/codes.ts';

// Payload (what the item asks) and response (what the user decided) per kind (10 §inbox_items).

export const questionPayloadSchema = z.object({
  question: z.string(),
  options: z.array(z.string()).optional(),
  blocking: z.boolean(),
  defaultAssumption: z.string().optional(),
});
export type QuestionPayload = z.infer<typeof questionPayloadSchema>;
export const questionAnswerSchema = z.object({ answer: z.string().trim().min(1) });
/** The model went on with its own assumption; recorded without asking (`ask_on_uncertainty` off). */
export const questionAssumedSchema = z.object({ assumed: z.literal(true), value: z.string() });
export const questionResponseSchema = z.union([questionAnswerSchema, questionAssumedSchema]);

export const permissionPayloadSchema = z.object({
  opencodePermissionId: z.string(),
  sessionId: z.string(),
  /** Session directory; opencode's reply needs it. */
  directory: z.string(),
  /** opencode permission type, e.g. `bash`, `webfetch`. */
  permission: z.string(),
  patterns: z.array(z.string()),
});
export type PermissionPayload = z.infer<typeof permissionPayloadSchema>;
export const permissionResponseSchema = z.object({ decision: permissionDecisionSchema });

export const acceptancePayloadSchema = z.object({});
export const acceptanceResponseSchema = z.object({
  accepted: z.boolean(),
  /** Required when rejecting: it is sent to the next attempt as feedback. */
  feedback: z.string().trim().min(1).optional(),
});
export type AcceptanceResponse = z.infer<typeof acceptanceResponseSchema>;

export const planPayloadSchema = z.object({ planId: z.string(), version: z.number() });
export const planResponseSchema = z.union([
  z.object({ confirmed: z.literal(true) }),
  z.object({ replanFeedback: z.string().trim().min(1) }),
]);
export type PlanResponse = z.infer<typeof planResponseSchema>;

export const failurePayloadSchema = z.object({ phase: taskFailedPhaseSchema, error: errorInfoSchema });
export const FailureAction = {
  Retry: 'retry',
  Cancel: 'cancel',
} as const;
export type FailureAction = (typeof FailureAction)[keyof typeof FailureAction];
export const failureResponseSchema = z.object({ action: z.enum(FailureAction) });

export const deliveryPayloadSchema = z.object({});
export const deliveryResponseSchema = z.object({ deliveryId: z.string() });

const base = {
  id: z.string(),
  status: inboxStatusSchema,
  taskId: z.string().nullable(),
  nodeId: z.string().nullable(),
  attemptId: z.string().nullable(),
  /** Short plain description (question text, permission pattern, step or task title); cards word the rest. */
  title: z.string(),
  createdAt: z.number(),
  resolvedAt: z.number().nullable(),
};
const item = <K extends InboxKind, P extends z.ZodType, R extends z.ZodType>(kind: K, payload: P, response: R) =>
  z.object({ ...base, kind: z.literal(kind), payload, response: response.nullable() });

/** `InboxItemDTO` (11 §7). */
export const inboxItemSchema = z.discriminatedUnion('kind', [
  item(InboxKind.Question, questionPayloadSchema, questionResponseSchema),
  item(InboxKind.Permission, permissionPayloadSchema, permissionResponseSchema),
  item(InboxKind.Acceptance, acceptancePayloadSchema, acceptanceResponseSchema),
  item(InboxKind.Plan, planPayloadSchema, planResponseSchema),
  item(InboxKind.Failure, failurePayloadSchema, failureResponseSchema),
  item(InboxKind.Delivery, deliveryPayloadSchema, deliveryResponseSchema),
]);
export type InboxItemDTO = z.infer<typeof inboxItemSchema>;
export type InboxItemOf<K extends InboxKind> = Extract<InboxItemDTO, { kind: K }>;

/** What a user may send to `POST /inbox/:id/resolve`; checked against the item's kind by the service. */
export const inboxResolveResponseSchema = z.union([
  questionAnswerSchema,
  permissionResponseSchema,
  acceptanceResponseSchema,
  planResponseSchema,
  failureResponseSchema,
]);

export const listInboxQuerySchema = z.object({
  status: inboxStatusSchema.optional(),
  taskId: z.string().optional(),
});
