import { once } from 'node:events';
import { createServer } from 'node:http';
import { BROWSER_READ_TIMEOUT_MS, ErrorCode, readWebsiteOp, updateSettingsOp } from '@aw/shared';
import { expect, it, onTestFinished } from 'vitest';
import { z } from 'zod';
import { createTestApp } from '../../../test/helpers/app.ts';
import { createFakeClock } from '../../../test/helpers/clock.ts';
import type { Clock } from '../../core/clock.ts';
import { createChromiumHost } from './host.chromium.ts';

it('无响应头的导航到整体截止时显式失败，关闭页面、请求并清理计时器', async () => {
  const accepted = Promise.withResolvers<void>();
  const disconnected = Promise.withResolvers<void>();
  const server = createServer((_req, res) => {
    res.on('close', disconnected.resolve);
    accepted.resolve();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected TCP address');
  const fakeClock = createFakeClock();
  const scheduled = new Set<() => void>();
  const clock: Clock = {
    now: fakeClock.now,
    schedule(ms, fn) {
      const fire = () => {
        scheduled.delete(fire);
        fn();
      };
      scheduled.add(fire);
      const cancel = fakeClock.schedule(ms, fire);
      return () => {
        scheduled.delete(fire);
        cancel();
      };
    },
  };
  const host = createChromiumHost();
  const t = await createTestApp({ browserHost: host, clock });
  onTestFinished(async () => {
    await host.close();
    await t.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });
  await t.call(updateSettingsOp, { 'browser.sites': [{ pattern: '127.0.0.1', access: 'interact' }] });
  await host.request({
    kind: 'open',
    tabId: 'observer',
    partition: 'observer',
    userFacing: false,
    viewport: null,
    policy: { previewOrigins: [], sites: [] },
  });
  const targets = async () =>
    z
      .object({ targetInfos: z.array(z.object({ targetId: z.string() })) })
      .parse(await host.request({ kind: 'cdp', tabId: 'observer', method: 'Target.getTargets' }))
      .targetInfos.map((target) => target.targetId)
      .sort();
  const before = await targets();
  const pendingTimers = scheduled.size;
  const response = t.call(readWebsiteOp, { url: `http://127.0.0.1:${address.port}/no-headers` });
  await accepted.promise;
  fakeClock.advance(BROWSER_READ_TIMEOUT_MS);
  expect(await response).toMatchObject({
    status: 502,
    body: { error: { code: ErrorCode.BrowserReadFailed, details: { reason: 'timeout' } } },
  });
  await disconnected.promise;
  expect(await targets()).toEqual(before);
  expect(scheduled.size).toBe(pendingTimers);
});

it.each(['open', 'initialize'] as const)('整体截止发生在 %s 尚未交付时，已分配的真实页面最终关闭', async (phase) => {
  const clock = createFakeClock();
  const opened = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  const host = createChromiumHost();
  const t = await createTestApp({
    clock,
    browserHost: {
      onEvent: host.onEvent,
      async request(op) {
        const result = await host.request(op);
        if (
          op.tabId.startsWith('assistant-read:') &&
          ((phase === 'open' && op.kind === 'open') ||
            (phase === 'initialize' && op.kind === 'cdp' && op.method === 'Page.enable'))
        ) {
          opened.resolve();
          await release.promise;
        }
        if (op.kind === 'close' && op.tabId.startsWith('assistant-read:')) closed.resolve();
        return result;
      },
    },
  });
  onTestFinished(async () => {
    release.resolve();
    await host.close();
    await t.close();
  });
  await host.request({
    kind: 'open',
    tabId: 'observer',
    partition: 'observer',
    userFacing: false,
    viewport: null,
    policy: { previewOrigins: [], sites: [] },
  });
  const targets = async () =>
    z
      .object({ targetInfos: z.array(z.object({ targetId: z.string() })) })
      .parse(await host.request({ kind: 'cdp', tabId: 'observer', method: 'Target.getTargets' }))
      .targetInfos.map((target) => target.targetId)
      .sort();
  const before = await targets();
  // 地址允许，但不应连接：宿主还未交付标签页，整体截止已先到。
  const read = t.call(readWebsiteOp, { url: 'http://127.0.0.1:1/not-visited' });
  await opened.promise;
  clock.advance(BROWSER_READ_TIMEOUT_MS);
  expect(await read).toMatchObject({
    status: 502,
    body: { error: { code: ErrorCode.BrowserReadFailed, details: { reason: 'timeout' } } },
  });
  if (phase === 'open') release.resolve();
  // 初始化 CDP 悬挂时无需等它回来即可关闭页；尚未交付的 open 则在迟到返回时关闭。
  await closed.promise;
  release.resolve();
  expect(await targets()).toEqual(before);
});
