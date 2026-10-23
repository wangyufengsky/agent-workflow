import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../../../test/helpers/clock.ts';
import { createNetworkTracker } from './browser.settle.ts';

const sent = (requestId: string, type = 'Fetch') => ['Network.requestWillBeSent', { requestId, type }] as const;
const done = (requestId: string) => ['Network.loadingFinished', { requestId }] as const;

describe('createNetworkTracker', () => {
  it('关闭时立即结束网络等待，之后推进时钟不再等待页面请求', async () => {
    const clock = createFakeClock();
    const tracker = createNetworkTracker(clock, 500);
    tracker.onEvent(...sent('pending'));
    const quiet = tracker.whenQuiet(10_000);
    tracker.close();
    await expect(quiet).resolves.toBe(false);
    clock.advance(10_000);
  });

  it('没有请求在进行、且安静满 500ms 才算稳定', async () => {
    const clock = createFakeClock();
    const tracker = createNetworkTracker(clock, 500);
    tracker.onEvent(...sent('a'));
    let settled: boolean | undefined;
    void tracker.whenQuiet(10_000).then((quiet) => (settled = quiet));

    clock.advance(1000);
    expect(settled).toBeUndefined();
    tracker.onEvent(...done('a'));
    clock.advance(499);
    await Promise.resolve();
    expect(settled).toBeUndefined();
    clock.advance(1);
    await Promise.resolve();
    expect(settled).toBe(true);
  });

  it('安静期间来了新请求就重新计时', async () => {
    const clock = createFakeClock();
    const tracker = createNetworkTracker(clock, 500);
    const quiet = tracker.whenQuiet(10_000);
    clock.advance(300);
    tracker.onEvent(...sent('b'));
    tracker.onEvent(...done('b'));
    clock.advance(300);
    let settled: boolean | undefined;
    void quiet.then((q) => (settled = q));
    await Promise.resolve();
    expect(settled).toBeUndefined();
    clock.advance(200);
    await expect(quiet).resolves.toBe(true);
  });

  it('请求一直不结束时到时限返回 false；EventSource 这类长连接不算在进行', async () => {
    const clock = createFakeClock();
    const tracker = createNetworkTracker(clock, 500);
    tracker.onEvent(...sent('poll'));
    const stuck = tracker.whenQuiet(10_000);
    clock.advance(10_000);
    await expect(stuck).resolves.toBe(false);

    const other = createNetworkTracker(clock, 500);
    other.onEvent(...sent('events', 'EventSource'));
    const quiet = other.whenQuiet(10_000);
    clock.advance(500);
    await expect(quiet).resolves.toBe(true);
  });
});
