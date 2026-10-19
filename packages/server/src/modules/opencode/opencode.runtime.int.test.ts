import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ErrorCode,
  getRuntimeOp,
  OPENCODE_VERSION,
  type RuntimeDTO,
  RuntimeStatus,
  restartRuntimeOp,
  ServerEventType,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';

let bin: string;
let launches: string;
let t: TestApp;

/** An `opencode` of the right version whose `serve` exits at once, recording each launch. */
async function crashingOpencode(): Promise<void> {
  const file = join(bin, 'opencode');
  await writeFile(
    file,
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo ${OPENCODE_VERSION}; exit 0; fi\necho launch >> "${launches}"\nexit 3\n`,
  );
  await chmod(file, 0o755);
}

/** Predicate matching the `n`-th `crashed` update it sees. */
function nthCrash(n: number) {
  let crashes = 0;
  return (r: RuntimeDTO) => r.status === RuntimeStatus.Crashed && ++crashes === n;
}

const launchCount = async () => (await readFile(launches, 'utf8')).split('\n').filter(Boolean).length;

beforeEach(async () => {
  bin = await mkdtemp(join(tmpdir(), 'aw-bin-'));
  launches = join(bin, 'launches.log');
  await crashingOpencode();
  t = await createTestApp({ env: { PATH: bin, HOME: bin }, realOpencode: true });
});
afterEach(() => t.close());

describe('opencode 运行时', () => {
  it('启动后进程退出时自动重启一次，之后停在 crashed', async () => {
    // The second crash: the automatic restart has been used up.
    const settled = waitForEvent(t.app.events, ServerEventType.RuntimeUpdated, nthCrash(2));
    await t.app.startRuntime(t.port);
    await settled;

    expect(await launchCount()).toBe(2);
    expect((await t.call(getRuntimeOp, {})).body).toMatchObject({ status: 'crashed', version: OPENCODE_VERSION });
  });

  it('手动重启重新允许一次自动重启', async () => {
    const firstRound = waitForEvent(t.app.events, ServerEventType.RuntimeUpdated, nthCrash(2));
    await t.app.startRuntime(t.port);
    await firstRound;

    const secondRound = waitForEvent(t.app.events, ServerEventType.RuntimeUpdated, nthCrash(2));
    expect((await t.call(restartRuntimeOp, {})).status).toBe(200);
    await secondRound;
    expect(await launchCount()).toBe(4);
  });

  it('opencode 未安装时不能重启', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'aw-empty-'));
    await t.close();
    t = await createTestApp({ env: { PATH: empty, HOME: empty }, realOpencode: true });
    const res = await t.call(restartRuntimeOp, {});
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: ErrorCode.StateTransitionInvalid } });
  });
});
