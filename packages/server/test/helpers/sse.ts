export type SseMessage = { id: string | undefined; event: string; data: unknown };

const WAIT_TIMEOUT_MS = 5000;

function parseBlock(block: string): SseMessage | undefined {
  const fields = new Map<string, string>();
  for (const line of block.split('\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) fields.set(line.slice(0, colon), line.slice(colon + 1).trimStart());
  }
  const data = fields.get('data');
  if (data === undefined) return undefined;
  return { id: fields.get('id'), event: fields.get('event') ?? 'message', data: JSON.parse(data) };
}

/** Minimal SSE client over fetch, so tests can send `Last-Event-ID` and await events instead of sleeping. */
export async function openEventStream(url: string, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const res = await fetch(url, { headers, signal: controller.signal });
  if (res.body === null) throw new Error(`No SSE body (${res.status})`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const received: SseMessage[] = [];
  const listeners = new Set<() => void>();
  let pending = '';

  const pump = async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      pending += value;
      for (let end = pending.indexOf('\n\n'); end !== -1; end = pending.indexOf('\n\n')) {
        const message = parseBlock(pending.slice(0, end));
        pending = pending.slice(end + 2);
        if (message !== undefined) received.push(message);
      }
      for (const listener of listeners) listener();
    }
  };
  // Aborting the request on close() rejects the pending read; that is the expected end of the stream.
  const pumping = pump().catch(() => undefined);

  return {
    status: res.status,
    received,
    /** Resolves once `count` messages have arrived; rejects after 5 s. */
    waitForCount(count: number): Promise<SseMessage[]> {
      return new Promise((resolve, reject) => {
        const check = () => {
          if (received.length < count) return;
          cleanup();
          resolve(received.slice(0, count));
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`Timed out waiting for ${count} SSE messages, got ${received.length}`));
        }, WAIT_TIMEOUT_MS);
        const cleanup = () => {
          clearTimeout(timer);
          listeners.delete(check);
        };
        listeners.add(check);
        check();
      });
    },
    async close() {
      controller.abort();
      await pumping;
    },
  };
}
