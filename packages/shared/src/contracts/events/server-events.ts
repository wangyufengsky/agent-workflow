import { z } from 'zod';
import { settingsSchema } from '../../constants/settings.ts';
import { ServerEventType } from '../../enums/system.ts';
import { attemptSummarySchema, transcriptEntrySchema } from '../api/attempts.ts';
import { inboxItemSchema } from '../api/inbox.ts';
import { runtimeSchema } from '../api/system.ts';
import { nodeSummarySchema, planSummarySchema, taskSummarySchema } from '../api/tasks.ts';

/** Domain events pushed over SSE (11 §11). Each milestone adds the events of the entities it introduces. */
export const serverEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(ServerEventType.SettingsUpdated),
    data: z.object({ keys: z.array(settingsSchema.keyof()) }),
  }),
  z.object({ type: z.literal(ServerEventType.RuntimeUpdated), data: runtimeSchema }),
  z.object({ type: z.literal(ServerEventType.TaskUpdated), data: taskSummarySchema }),
  z.object({
    type: z.literal(ServerEventType.NodeUpdated),
    data: z.object({ taskId: z.string(), node: nodeSummarySchema }),
  }),
  z.object({
    type: z.literal(ServerEventType.PlanUpdated),
    data: z.object({ taskId: z.string(), plan: planSummarySchema }),
  }),
  z.object({
    type: z.literal(ServerEventType.InboxUpdated),
    data: z.object({ item: inboxItemSchema, openCount: z.number() }),
  }),
  z.object({
    type: z.literal(ServerEventType.AttemptUpdated),
    data: z.object({ taskId: z.string().nullable(), nodeId: z.string().nullable(), attempt: attemptSummarySchema }),
  }),
  z.object({
    type: z.literal(ServerEventType.AttemptTranscript),
    data: z.object({ attemptId: z.string(), entries: z.array(transcriptEntrySchema) }),
  }),
]);
export type ServerEvent = z.infer<typeof serverEventSchema>;
