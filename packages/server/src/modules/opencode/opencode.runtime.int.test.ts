import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ErrorCode,
  getRuntimeOp,
  OPENCODE_VERSION,
  type RuntimeDTO,
  RuntimeStatus,
  recheckEnvironmentOp,
  restartRuntimeOp,
  ServerEventType,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { isolatedEnv, writeFakeExecutable } from '../../../test/helpers/executables.ts';

let bin: string;
let launches: string;
let t: TestApp;

/** An `opencode` of the right version whose `serve` exits at once, recording each launch. */
async function crashingOpencode(): Promise<void> {
  await writeFakeExecutable(
    bin,
    'opencode',
    `import { appendFileSync } from 'node:fs';
if (process.argv[2] === '--version') {
  console.log(${JSON.stringify(OPENCODE_VERSION)});
} else {
  appendFileSync(${JSON.stringify(launches)}, 'launch\\n');
  process.exit(3);
}
`,
  );
}

/** Git stays reachable: on Windows the opencode configuration needs Git Bash (D72). */
const appIn = async (dir: string) =>
  createTestApp({ env: await isolatedEnv(dir, dir, { git: true }), realOpencode: true });

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
  t = await appIn(bin);
});
afterEach(() => t.close());

describe('opencode 运行时', () => {
  it('启动后进程退出时自动重启一次，之后停在 crashed', async () => {
    // The second crash: the automatic restart has been used up.
    const settled = waitForEvent(t.app.events, ServerEventType.RuntimeUpdated, nthCrash(2));
    await t.app.start(t.port);
    await settled;

    expect(await launchCount()).toBe(2);
    expect((await t.call(getRuntimeOp, {})).body).toMatchObject({ status: 'crashed', version: OPENCODE_VERSION });
  });

  it('手动重启重新允许一次自动重启', async () => {
    const firstRound = waitForEvent(t.app.events, ServerEventType.RuntimeUpdated, nthCrash(2));
    await t.app.start(t.port);
    await firstRound;

    const secondRound = waitForEvent(t.app.events, ServerEventType.RuntimeUpdated, nthCrash(2));
    expect((await t.call(restartRuntimeOp, {})).status).toBe(200);
    await secondRound;
    expect(await launchCount()).toBe(4);
  });

  it('停在 crashed 时重新检测环境会再次启动（如 Windows 上补装 Git Bash 之后），并重新允许一次自动重启', async () => {
    const crashed = waitForEvent(t.app.events, ServerEventType.RuntimeUpdated, nthCrash(2));
    await t.app.start(t.port);
    await crashed;

    const again = waitForEvent(t.app.events, ServerEventType.RuntimeUpdated, nthCrash(2));
    expect((await t.call(recheckEnvironmentOp, {})).status).toBe(200);
    await again;
    expect(await launchCount()).toBe(4);
  });

  it('安装 opencode 后重新检测即启动运行时', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'aw-empty-'));
    await t.close();
    t = await appIn(empty);
    await t.app.start(t.port);
    expect((await t.call(getRuntimeOp, {})).body.status).toBe(RuntimeStatus.NotInstalled);

    bin = empty;
    launches = join(empty, 'launches.log');
    await crashingOpencode();
    const settled = waitForEvent(t.app.events, ServerEventType.RuntimeUpdated, nthCrash(2));
    await t.call(recheckEnvironmentOp, {});
    await settled;
    expect(await launchCount()).toBe(2);
  });

  it('opencode 未安装时不能重启', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'aw-empty-'));
    await t.close();
    t = await appIn(empty);
    const res = await t.call(restartRuntimeOp, {});
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: ErrorCode.StateTransitionInvalid } });
  });
});
