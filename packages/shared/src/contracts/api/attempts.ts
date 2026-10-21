import { z } from 'zod';
import { TranscriptEntryKind, transcriptSystemEventSchema } from '../../enums/system.ts';
import { attemptKindSchema, attemptStatusSchema } from '../../enums/task.ts';
import { errorInfoSchema } from '../../errors/codes.ts';

/** `AttemptSummaryDTO` (11 §6): one AI session working for a node, a plan or a review. */
export const attemptSummarySchema = z.object({
  id: z.string(),
  /** Null for development-build debug attempts (M2-09), which belong to no task. */
  taskId: z.string().nullable(),
  nodeId: z.string().nullable(),
  kind: attemptKindSchema,
  seq: z.number(),
  status: attemptStatusSchema,
  /** `provider/model` sent with the prompts; null uses opencode's default. */
  model: z.string().nullable(),
  nudges: z.number(),
  error: errorInfoSchema.nullable(),
  /** Latest `report_progress` line while the attempt is active; kept in memory only (12 §6.8). */
  progress: z.string().nullable(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
});
export type AttemptSummaryDTO = z.infer<typeof attemptSummarySchema>;

export const attemptSchema = attemptSummarySchema.extend({
  directory: z.string(),
  opencodeSessionId: z.string().nullable(),
  tokensInput: z.number().nullable(),
  tokensOutput: z.number().nullable(),
  cost: z.number().nullable(),
});
export type AttemptDTO = z.infer<typeof attemptSchema>;

const entry = { seq: z.number(), ts: z.number() };
const part = { ...entry, partId: z.string() };

/**
 * One line of `runs/<taskId>/<attemptId>.jsonl` and of the assistant's `conversations/<id>.jsonl` (10 §3). Streaming
 * text repeats its `partId`; the last line wins.
 */
export const transcriptEntrySchema = z.discriminatedUnion('kind', [
  z.object({ ...entry, kind: z.literal(TranscriptEntryKind.UserMessage), data: z.object({ text: z.string() }) }),
  z.object({ ...part, kind: z.literal(TranscriptEntryKind.Text), data: z.object({ text: z.string() }) }),
  z.object({ ...part, kind: z.literal(TranscriptEntryKind.Reasoning), data: z.object({ text: z.string() }) }),
  z.object({
    ...entry,
    kind: z.literal(TranscriptEntryKind.ToolCall),
    data: z.object({ tool: z.string(), callId: z.string(), input: z.record(z.string(), z.unknown()) }),
  }),
  z.object({
    ...entry,
    kind: z.literal(TranscriptEntryKind.ToolResult),
    data: z.object({
      tool: z.string(),
      callId: z.string(),
      status: z.enum(['completed', 'error']),
      output: z.string().optional(),
      error: z.string().optional(),
    }),
  }),
  z.object({
    ...entry,
    kind: z.literal(TranscriptEntryKind.Permission),
    data: z.object({ permissionId: z.string(), permission: z.string(), patterns: z.array(z.string()) }),
  }),
  z.object({
    ...entry,
    kind: z.literal(TranscriptEntryKind.System),
    data: z.object({ event: transcriptSystemEventSchema, detail: z.string().optional() }),
  }),
  z.object({ ...entry, kind: z.literal(TranscriptEntryKind.Error), data: errorInfoSchema }),
  z.object({
    ...entry,
    kind: z.literal(TranscriptEntryKind.Confirmation),
    data: z.object({ confirmationId: z.string() }),
  }),
  /** `path` is relative to the conversation's files directory. */
  z.object({ ...entry, kind: z.literal(TranscriptEntryKind.Attachment), data: z.object({ path: z.string() }) }),
]);
export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>;

export const transcriptQuerySchema = z.object({ afterSeq: z.coerce.number().int().min(0).default(0) });

/** `GET /attempts/:id/transcript?afterSeq=` (11 §6). */
export const transcriptPageSchema = z.object({
  entries: z.array(transcriptEntrySchema),
  /** Highest seq in this page (the request's `afterSeq` when empty); pass it as the next `afterSeq`. */
  lastSeq: z.number(),
  /** Lines after this page were already written: read on with `afterSeq = lastSeq`. */
  hasMore: z.boolean(),
  /** The attempt has ended and this page reaches the end of its transcript. */
  done: z.boolean(),
});
export type TranscriptPage = z.infer<typeof transcriptPageSchema>;
