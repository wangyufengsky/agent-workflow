import {
  API_PREFIX,
  AttemptKind,
  type ServerEvent,
  ServerEventType,
  serverEventSchema,
  TranscriptEntryKind,
} from '@aw/shared';
import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import {
  conversationTranscript,
  updateConfirmation,
  updateConversation,
} from '../features/assistant/assistant.queries.ts';
import { appendTranscript, attemptTranscript, updateAttempt } from '../features/attempts/attempt.queries.ts';
import { connectCompanionEvents } from '../features/companion/companion-events.ts';
import { refreshGitReview } from '../features/git/git.queries.ts';
import { updateInbox } from '../features/inbox/inbox.queries.ts';
import { refreshInitiatives } from '../features/initiatives/initiatives.queries.ts';
import { refreshKnowledge } from '../features/knowledge/knowledge.queries.ts';
import { refreshDecks } from '../features/ppt/ppt.queries.ts';
import { appendFrame } from '../features/preview/preview.queries.ts';
import { refreshSchedules } from '../features/schedules/schedules.queries.ts';
import { updateNode, updateTask } from '../features/tasks/tasks.queries.ts';
import { useUiStore } from '../state/ui.store.ts';
import { apiToken } from './client.ts';
import { queryKeys } from './query-keys.ts';

const DECK_ATTEMPT_KINDS: readonly AttemptKind[] = [AttemptKind.DeckOutline, AttemptKind.DeckSlides];

/** Quality and usage figures are read again whenever what they count changed (19 §3). */
const refreshInsights = (qc: QueryClient) => qc.invalidateQueries({ queryKey: queryKeys.insightsAll });

/** How each SSE event updates the cache; events are invalidation hints and increments, the queries stay the source of truth. */
async function applyEvent(qc: QueryClient, event: ServerEvent): Promise<void> {
  switch (event.type) {
    case ServerEventType.SettingsUpdated:
      return qc.invalidateQueries({ queryKey: queryKeys.settings });
    case ServerEventType.RuntimeUpdated:
      qc.setQueryData(queryKeys.runtime, event.data);
      // Whether models are available, and which MCP servers are connected, depends on the runtime.
      await qc.invalidateQueries({ queryKey: queryKeys.externalMcp });
      return qc.invalidateQueries({ queryKey: queryKeys.environment });
    case ServerEventType.AttemptUpdated:
      await updateAttempt(qc, event.data.attempt);
      // A research turn's progress line and status are part of its knowledge conversation (18 §4).
      if (event.data.attempt.kind === AttemptKind.Research) await refreshKnowledge(qc);
      // A PPT's progress line and status come from its AI work's attempt (23 §4.3).
      if (DECK_ATTEMPT_KINDS.includes(event.data.attempt.kind)) await refreshDecks(qc);
      // A task's active attempts (and their progress line) are part of its detail, their status of its preview's
      // sessions (29 §8.1).
      if (event.data.taskId !== null) {
        await qc.invalidateQueries({ queryKey: queryKeys.task(event.data.taskId), exact: true });
        await qc.invalidateQueries({ queryKey: queryKeys.previewSessions(event.data.taskId) });
      }
      if (event.data.nodeId !== null && event.data.taskId !== null) {
        await qc.invalidateQueries({ queryKey: queryKeys.node(event.data.taskId, event.data.nodeId) });
      }
      // Usage is counted per attempt, a knowledge question's too.
      return refreshInsights(qc);
    case ServerEventType.AttemptTranscript:
      return appendTranscript(qc, attemptTranscript(event.data.attemptId), event.data.entries);
    case ServerEventType.TaskUpdated:
      await updateTask(qc, event.data);
      // Quality is counted over the tasks that ended.
      return refreshInsights(qc);
    case ServerEventType.NodeUpdated:
      return updateNode(qc, event.data.taskId, event.data.node);
    case ServerEventType.PlanUpdated:
    case ServerEventType.DeliveryUpdated:
      return qc.invalidateQueries({ queryKey: queryKeys.task(event.data.taskId), exact: true });
    case ServerEventType.InboxUpdated:
      await updateInbox(qc, event.data.blockingCount);
      // Questions and permission requests are counted as interruptions, a knowledge researcher's too.
      return refreshInsights(qc);
    case ServerEventType.AssistantUpdated:
      return updateConversation(qc, event.data);
    case ServerEventType.AssistantTranscript: {
      appendTranscript(qc, conversationTranscript(event.data.conversationId), event.data.entries);
      // A file the assistant wrote shows as an attachment with its path on disk.
      if (event.data.entries.some((e) => e.kind === TranscriptEntryKind.Attachment)) {
        await qc.invalidateQueries({ queryKey: queryKeys.assistantFiles(event.data.conversationId) });
      }
      return;
    }
    case ServerEventType.KnowledgeUpdated:
      return refreshKnowledge(qc);
    case ServerEventType.DeckUpdated:
      return refreshDecks(qc);
    case ServerEventType.GitReviewUpdated:
      return refreshGitReview(qc, event.data.projectId, event.data.reviewId);
    case ServerEventType.TeamAnalysisUpdated:
      return qc.invalidateQueries({ queryKey: queryKeys.team(event.data.projectId) });
    case ServerEventType.TeamScanUpdated:
      qc.setQueryData(queryKeys.teamScan(event.data.projectId), event.data);
      return;
    case ServerEventType.ScheduleUpdated:
      await refreshSchedules(qc, event.data.scheduleId);
      return;
    case ServerEventType.InitiativeUpdated:
      await refreshInitiatives(qc, event.data.initiativeId);
      return;
    case ServerEventType.PreviewUpdated:
      qc.setQueryData(queryKeys.preview(event.data.taskId), event.data);
      return;
    case ServerEventType.BrowserFrame:
      return appendFrame(qc, event.data);
    case ServerEventType.BrowserTabUpdated:
      qc.setQueryData(queryKeys.userTab(event.data.tabId), event.data);
      return qc.invalidateQueries({ queryKey: queryKeys.userTabLogs(event.data.tabId) });
    case ServerEventType.AssistantConfirmation:
      return updateConfirmation(qc, event.data);
    // Requests of the assistant to the renderer, carried out by the shell (15 §6).
    case ServerEventType.AssistantNavigate:
      return useUiStore.getState().requestFromAssistant({ kind: 'navigate', target: event.data.target });
    case ServerEventType.AssistantOpenForm:
      return useUiStore
        .getState()
        .requestFromAssistant({ kind: 'form', form: event.data.form, values: event.data.values });
    case ServerEventType.AssistantRevealFile:
      return useUiStore.getState().requestFromAssistant({ kind: 'reveal', absolutePath: event.data.absolutePath });
  }
}

/** Subscribes to `/api/v1/events`; EventSource reconnects by itself and sends `Last-Event-ID` (11 §11). */
export function useServerEvents(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const companion = window.aw?.companion.surface === null ? undefined : connectCompanionEvents(queryClient);
    const source = new EventSource(`${API_PREFIX}/events?token=${encodeURIComponent(apiToken())}`);
    for (const { shape } of serverEventSchema.options) {
      const type = shape.type.value;
      source.addEventListener(type, (message) => {
        // The backend is a boundary: events are parsed with the shared schema.
        const event = serverEventSchema.parse({ type, data: JSON.parse(message.data) });
        companion?.event(event);
        void applyEvent(queryClient, event);
      });
    }
    source.addEventListener(ServerEventType.Resync, () => {
      void queryClient.invalidateQueries();
      void companion?.resync();
    });
    return () => {
      source.close();
      companion?.close();
    };
  }, [queryClient]);
}
