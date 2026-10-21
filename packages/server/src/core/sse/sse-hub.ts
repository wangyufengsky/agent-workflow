import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { API_PREFIX, type ServerEvent, ServerEventType, SSE_REPLAY_BUFFER } from '@aw/shared';
import type { FastifyInstance } from 'fastify';
import type { EventBus } from '../event-bus.ts';

type Entry = { seq: number; event: ServerEvent };

/**
 * Forwards event-bus events to every `GET /api/v1/events` client (11 §11).
 * Ids are `<bootId>-<seq>`; a reconnect with `Last-Event-ID` replays from the in-memory buffer, and when the
 * gap cannot be filled (buffer overrun, or the backend restarted) the client gets `resync` and refetches everything.
 * A first connection gets `resync` too: the client read its data before the stream was open, and events in between
 * would otherwise be lost (a page showing two of three permission requests until the next event).
 */
export function registerSseHub(server: FastifyInstance, events: EventBus, bufferSize = SSE_REPLAY_BUFFER): void {
  const bootId = randomUUID().slice(0, 8);
  const buffer: Entry[] = [];
  const clients = new Set<ServerResponse>();
  let seq = 0;

  const id = (n: number) => `${bootId}-${n}`;
  const write = (res: ServerResponse, n: number, type: string, data: unknown) =>
    res.write(`id: ${id(n)}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`);

  events.subscribe((event) => {
    seq += 1;
    buffer.push({ seq, event });
    if (buffer.length > bufferSize) buffer.shift();
    for (const res of clients) write(res, seq, event.type, event.data);
  });

  /** Entries after `lastEventId`, or undefined when they cannot all be replayed. */
  function replayAfter(lastEventId: string): Entry[] | undefined {
    const match = /^([0-9a-f]+)-(\d+)$/.exec(lastEventId);
    if (match?.[1] !== bootId) return undefined;
    const last = Number(match[2]);
    const oldest = buffer[0]?.seq ?? seq + 1;
    if (last > seq || last + 1 < oldest) return undefined;
    return buffer.filter((e) => e.seq > last);
  }

  server.get(`${API_PREFIX}/events`, (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const lastEventId = req.headers['last-event-id'];
    const missed = typeof lastEventId === 'string' ? replayAfter(lastEventId) : undefined;
    if (missed === undefined) write(res, seq, ServerEventType.Resync, {});
    else for (const e of missed) write(res, e.seq, e.event.type, e.event.data);
    clients.add(res);
    req.raw.on('close', () => clients.delete(res));
  });

  // Open streams would otherwise keep server.close() waiting forever.
  server.addHook('preClose', async () => {
    for (const res of clients) res.end();
    clients.clear();
  });
}
