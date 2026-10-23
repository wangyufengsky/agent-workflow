import {
  type BrowserPortEvent,
  type BrowserPortRequest,
  type BrowserPortResponse,
  browserPortEventSchema,
  browserPortResponseSchema,
} from '@aw/shared';
import type { BrowserHost } from './browser.host.ts';

/** Message channel to Electron main, which holds the tabs (`process.parentPort` in the desktop app). */
export type BrowserTransport = {
  send(message: BrowserPortRequest): void;
  onMessage(listener: (message: unknown) => void): void;
};

/** Requests by id over the transport; main answers each once and sends events unasked (29 §5.1). */
export function createPortBrowserHost(transport: BrowserTransport): BrowserHost {
  let nextId = 1;
  const pending = new Map<number, (response: BrowserPortResponse) => void>();
  const listeners = new Set<(event: BrowserPortEvent) => void>();
  transport.onMessage((message) => {
    // The same port carries the credential and lifecycle messages.
    const response = browserPortResponseSchema.safeParse(message);
    if (response.success) {
      pending.get(response.data.id)?.(response.data);
      pending.delete(response.data.id);
      return;
    }
    const event = browserPortEventSchema.safeParse(message);
    if (event.success) for (const listener of listeners) listener(event.data);
  });
  return {
    async request(op) {
      const id = nextId++;
      const response = await new Promise<BrowserPortResponse>((resolve) => {
        pending.set(id, resolve);
        transport.send({ type: 'browser.request', id, op });
      });
      // A CDP error (a node gone, a box not computable) is the caller's to interpret.
      if (!response.ok) throw new Error(response.error);
      return response.result;
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function parentPortBrowserTransport(port: NonNullable<NodeJS.Process['parentPort']>): BrowserTransport {
  return {
    send: (message) => port.postMessage(message),
    onMessage: (listener) => port.on('message', (event) => listener(event.data)),
  };
}
