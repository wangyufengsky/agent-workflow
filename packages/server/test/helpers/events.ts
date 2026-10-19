import type { ServerEvent, ServerEventType } from '@aw/shared';
import type { EventBus } from '../../src/core/event-bus.ts';

const DEFAULT_TIMEOUT_MS = 5000;

type EventData<T extends ServerEventType> = Extract<ServerEvent, { type: T }>['data'];

/**
 * Resolves with the first event of `type` (published after the call) that satisfies `predicate`; replaces sleeps (07 §4).
 * Subscribe before triggering the action that publishes the event.
 */
export async function waitForEvent<T extends ServerEventType>(
  events: EventBus,
  type: T,
  predicate: (data: EventData<T>) => boolean = () => true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<EventData<T>> {
  const data = await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for ${type}`));
    }, timeoutMs);
    const unsubscribe = events.subscribe((event) => {
      if (event.type !== type) return;
      if (!predicate(event.data as EventData<T>)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(event.data);
    });
  });
  return data as EventData<T>;
}
