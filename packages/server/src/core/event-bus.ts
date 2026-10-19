import type { ServerEvent } from '@aw/shared';

export type EventListener = (event: ServerEvent) => void;

/** In-process domain events; the SSE hub forwards them to the renderer. Publish only after the transaction commits. */
export type EventBus = {
  publish(event: ServerEvent): void;
  subscribe(listener: EventListener): () => void;
};

export function createEventBus(): EventBus {
  const listeners = new Set<EventListener>();
  return {
    publish(event) {
      for (const listener of listeners) listener(event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
