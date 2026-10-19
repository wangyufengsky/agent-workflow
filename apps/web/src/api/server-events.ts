import { API_PREFIX, ServerEventType } from '@aw/shared';
import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiToken } from './client.ts';
import { queryKeys } from './query-keys.ts';

/** How each SSE event updates the cache; events are invalidation hints, the queries stay the source of truth. */
const ON_EVENT: Partial<Record<ServerEventType, (queryClient: QueryClient) => Promise<void>>> = {
  [ServerEventType.SettingsUpdated]: (qc) => qc.invalidateQueries({ queryKey: queryKeys.settings }),
  [ServerEventType.Resync]: (qc) => qc.invalidateQueries(),
};

/** Subscribes to `/api/v1/events`; EventSource reconnects by itself and sends `Last-Event-ID` (11 §11). */
export function useServerEvents(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const source = new EventSource(`${API_PREFIX}/events?token=${encodeURIComponent(apiToken())}`);
    for (const [type, handle] of Object.entries(ON_EVENT)) {
      source.addEventListener(type, () => void handle(queryClient));
    }
    return () => source.close();
  }, [queryClient]);
}
