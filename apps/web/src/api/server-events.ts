import { API_PREFIX, type ServerEvent, ServerEventType, serverEventSchema } from '@aw/shared';
import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { appendTranscript, updateAttempt } from '../features/attempts/attempt.queries.ts';
import { apiToken } from './client.ts';
import { queryKeys } from './query-keys.ts';

/** How each SSE event updates the cache; events are invalidation hints and increments, the queries stay the source of truth. */
async function applyEvent(qc: QueryClient, event: ServerEvent): Promise<void> {
  switch (event.type) {
    case ServerEventType.SettingsUpdated:
      return qc.invalidateQueries({ queryKey: queryKeys.settings });
    case ServerEventType.RuntimeUpdated:
      qc.setQueryData(queryKeys.runtime, event.data);
      // Whether models are available depends on the runtime.
      return qc.invalidateQueries({ queryKey: queryKeys.environment });
    case ServerEventType.AttemptUpdated:
      return updateAttempt(qc, event.data.attempt);
    case ServerEventType.AttemptTranscript:
      return appendTranscript(qc, event.data.attemptId, event.data.entries);
  }
}

/** Subscribes to `/api/v1/events`; EventSource reconnects by itself and sends `Last-Event-ID` (11 §11). */
export function useServerEvents(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const source = new EventSource(`${API_PREFIX}/events?token=${encodeURIComponent(apiToken())}`);
    for (const { shape } of serverEventSchema.options) {
      const type = shape.type.value;
      source.addEventListener(type, (message) => {
        // The backend is a boundary: events are parsed with the shared schema.
        void applyEvent(queryClient, serverEventSchema.parse({ type, data: JSON.parse(message.data) }));
      });
    }
    source.addEventListener(ServerEventType.Resync, () => void queryClient.invalidateQueries());
    return () => source.close();
  }, [queryClient]);
}
