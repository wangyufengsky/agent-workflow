import { z } from 'zod';
import { settingsSchema } from '../../constants/settings.ts';
import { assistantFormSchema } from '../../enums/assistant.ts';
import { ServerEventType } from '../../enums/system.ts';
import { assistantConfirmationSchema, assistantConversationSchema, assistantPageRefSchema } from '../api/assistant.ts';
import { attemptSummarySchema, transcriptEntrySchema } from '../api/attempts.ts';
import { browserFrameSchema, userTabStateSchema } from '../api/browser.ts';
import { deliverySchema } from '../api/delivery.ts';
import { inboxItemSchema } from '../api/inbox.ts';
import { previewSchema } from '../api/previews.ts';
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
    data: z.object({ item: inboxItemSchema, blockingCount: z.number() }),
  }),
  z.object({
    type: z.literal(ServerEventType.AttemptUpdated),
    data: z.object({ taskId: z.string().nullable(), nodeId: z.string().nullable(), attempt: attemptSummarySchema }),
  }),
  z.object({
    type: z.literal(ServerEventType.DeliveryUpdated),
    data: z.object({ taskId: z.string(), delivery: deliverySchema }),
  }),
  z.object({
    type: z.literal(ServerEventType.AttemptTranscript),
    data: z.object({ attemptId: z.string(), entries: z.array(transcriptEntrySchema) }),
  }),
  z.object({ type: z.literal(ServerEventType.AssistantUpdated), data: assistantConversationSchema }),
  z.object({ type: z.literal(ServerEventType.KnowledgeUpdated), data: z.object({ conversationId: z.string() }) }),
  z.object({ type: z.literal(ServerEventType.DeckUpdated), data: z.object({ deckId: z.string() }) }),
  z.object({
    type: z.literal(ServerEventType.GitReviewUpdated),
    data: z.object({ reviewId: z.string(), projectId: z.string() }),
  }),
  z.object({ type: z.literal(ServerEventType.ScheduleUpdated), data: z.object({ scheduleId: z.string() }) }),
  z.object({
    type: z.literal(ServerEventType.TeamScanUpdated),
    /** Commits read so far out of those missing; `done = total` when the reading finished. */
    data: z.object({ projectId: z.string(), done: z.number(), total: z.number() }),
  }),
  z.object({
    type: z.literal(ServerEventType.TeamAnalysisUpdated),
    data: z.object({ projectId: z.string(), analysisId: z.string() }),
  }),
  z.object({ type: z.literal(ServerEventType.PreviewUpdated), data: previewSchema }),
  z.object({ type: z.literal(ServerEventType.BrowserFrame), data: browserFrameSchema }),
  z.object({ type: z.literal(ServerEventType.BrowserTabUpdated), data: userTabStateSchema }),
  z.object({
    type: z.literal(ServerEventType.AssistantTranscript),
    data: z.object({ conversationId: z.string(), entries: z.array(transcriptEntrySchema) }),
  }),
  z.object({ type: z.literal(ServerEventType.AssistantConfirmation), data: assistantConfirmationSchema }),
  z.object({
    type: z.literal(ServerEventType.AssistantNavigate),
    data: z.object({ conversationId: z.string(), target: assistantPageRefSchema }),
  }),
  z.object({
    type: z.literal(ServerEventType.AssistantOpenForm),
    data: z.object({
      conversationId: z.string(),
      form: assistantFormSchema,
      values: z.record(z.string(), z.unknown()),
    }),
  }),
  z.object({
    type: z.literal(ServerEventType.AssistantRevealFile),
    data: z.object({ conversationId: z.string(), absolutePath: z.string() }),
  }),
]);
export type ServerEvent = z.infer<typeof serverEventSchema>;
