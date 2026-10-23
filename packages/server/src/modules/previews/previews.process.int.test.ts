import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErrorCode, PREVIEW_START_TIMEOUT_MS } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../../../test/helpers/clock.ts';
import { locateShell } from '../git/index.ts';
import { createPreviewLog, launchPreview, type PreviewLog } from './previews.process.ts';

/** A log that also tells the test when the dev server has written `text`. */
function logWaitingFor(text: string): { log: PreviewLog; seen: Promise<void> } {
  const log = createPreviewLog(null);
  const { promise: seen, resolve } = Promise.withResolvers<void>();
  return {
    log: {
      ...log,
      append(chunk) {
        log.append(chunk);
        if (log.tail().includes(text)) resolve();
      },
    },
    seen,
  };
}

describe('launchPreview', () => {
  it('没有在时限内就绪时结束开发服务器，以 PREVIEW_START_FAILED 失败并带上日志末尾', async () => {
    const clock = createFakeClock();
    const { log, seen } = logWaitingFor('never listens');
    const launching = launchPreview({
      directory: await mkdtemp(join(tmpdir(), 'aw-preview-')),
      config: {
        command: `node -e "console.log('never listens'); setInterval(() => {}, 1000)"`,
        setupCommand: null,
        readyPath: '/',
        pages: ['/'],
        extraOrigins: [],
      },
      shell: await locateShell(process.env),
      env: process.env,
      clock,
      log,
      signal: new AbortController().signal,
    });
    // The timeout is armed before the server can write anything.
    await seen;
    clock.advance(PREVIEW_START_TIMEOUT_MS);

    await expect(launching).rejects.toMatchObject({
      code: ErrorCode.PreviewStartFailed,
      message: `Not ready within ${PREVIEW_START_TIMEOUT_MS} ms`,
      details: { logTail: expect.stringContaining('never listens') },
    });
  });
});
