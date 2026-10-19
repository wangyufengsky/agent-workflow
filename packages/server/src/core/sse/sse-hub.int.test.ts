import { API_PREFIX, ServerEventType, SSE_REPLAY_BUFFER } from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, TEST_TOKEN, type TestApp } from '../../../test/helpers/app.ts';
import { openEventStream } from '../../../test/helpers/sse.ts';

let t: TestApp;
let url: string;
beforeEach(async () => {
  t = await createTestApp();
  url = `http://127.0.0.1:${t.port}${API_PREFIX}/events?token=${TEST_TOKEN}`;
});
afterEach(() => t.close());

const publish = (n: number) => {
  for (let i = 0; i < n; i++) {
    t.app.events.publish({ type: ServerEventType.SettingsUpdated, data: { keys: ['ui.theme'] } });
  }
};

describe('SSE 事件流', () => {
  it('查询参数令牌错误时返回 401', async () => {
    const res = await fetch(url.replace(TEST_TOKEN, 'x'.repeat(64)));
    expect(res.status).toBe(401);
  });

  it('推送事件，id 单调递增', async () => {
    const stream = await openEventStream(url);
    publish(2);
    const [a, b] = await stream.waitForCount(2);
    expect(a).toMatchObject({ event: 'settings.updated', data: { keys: ['ui.theme'] } });
    expect(Number(b?.id?.split('-')[1])).toBe(Number(a?.id?.split('-')[1]) + 1);
    await stream.close();
  });

  it('断线后带 Last-Event-ID 重连能补齐错过的事件', async () => {
    const first = await openEventStream(url);
    publish(1);
    const [seen] = await first.waitForCount(1);
    await first.close();

    publish(3);
    const second = await openEventStream(url, { 'last-event-id': seen?.id ?? '' });
    const missed = await second.waitForCount(3);
    expect(missed.map((m) => Number(m.id?.split('-')[1]))).toEqual([2, 3, 4]);
    expect(missed.every((m) => m.event === 'settings.updated')).toBe(true);
    await second.close();
  });

  it('错过的事件超出回放缓冲时收到 resync', async () => {
    const first = await openEventStream(url);
    publish(1);
    const [seen] = await first.waitForCount(1);
    await first.close();

    publish(SSE_REPLAY_BUFFER + 1);
    const second = await openEventStream(url, { 'last-event-id': seen?.id ?? '' });
    const [message] = await second.waitForCount(1);
    expect(message).toMatchObject({ event: 'resync', data: {} });
    await second.close();
  });

  it('Last-Event-ID 来自上一次启动的后端时收到 resync', async () => {
    const stream = await openEventStream(url, { 'last-event-id': 'deadbeef-3' });
    const [message] = await stream.waitForCount(1);
    expect(message?.event).toBe('resync');
    await stream.close();
  });
});
