import { RuntimeStatus, ServerEventType } from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';

/** Real opencode 1.19.0 from PATH / ~/.opencode/bin; no model is called (07 §2). */
const START_TIMEOUT_MS = 60_000;

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

describe('@opencode 运行时托管', () => {
  it('启动到 ready；进程被杀后自动恢复', async () => {
    await t.app.startRuntime(0);
    const ready = await t.app.services.runtime.snapshot();
    expect(ready).toMatchObject({
      status: RuntimeStatus.Ready,
      url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
    });

    const pid = t.app.services.runtime.processId();
    if (pid === undefined) throw new Error('ready runtime has no process');
    const crashed = waitForEvent(
      t.app.events,
      ServerEventType.RuntimeUpdated,
      (r) => r.status === RuntimeStatus.Crashed,
    );
    const recovered = waitForEvent(
      t.app.events,
      ServerEventType.RuntimeUpdated,
      (r) => r.status === RuntimeStatus.Ready,
      START_TIMEOUT_MS,
    );
    process.kill(pid, 'SIGKILL');
    await crashed;
    await recovered;
    expect(t.app.services.runtime.processId()).not.toBe(pid);
  });
});
