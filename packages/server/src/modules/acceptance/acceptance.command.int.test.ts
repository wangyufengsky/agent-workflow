import { existsSync, watch } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACCEPTANCE_COMMAND_TIMEOUT_MS } from '@aw/shared';
import { pino } from 'pino';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeClock, type FakeClock } from '../../../test/helpers/clock.ts';
import { type AcceptanceServiceDeps, createAcceptanceService } from './acceptance.service.ts';

let clock: FakeClock;
let dir: string;

/** Only `runCommand` is exercised: the review collaborators are never called. */
function service() {
  const unused = {} as never;
  const deps: AcceptanceServiceDeps = {
    attempts: { onSignal: () => () => undefined } as never,
    roles: unused,
    settings: unused,
    prompts: unused,
    log: pino({ level: 'silent' }),
    clock,
    env: process.env,
  };
  return createAcceptanceService(deps);
}

/** Resolves once `file` exists in `dir` (event-driven, 07 §1). */
function created(file: string): Promise<void> {
  return new Promise((resolve) => {
    const watcher = watch(dir, () => {
      if (!existsSync(join(dir, file))) return;
      watcher.close();
      resolve();
    });
    if (existsSync(join(dir, file))) {
      watcher.close();
      resolve();
    }
  });
}

/** A shell whose command keeps running in a child process; the child holds the output pipe until it ends. */
const LONG_RUNNING = `node -e "require('fs').writeFileSync('started', ''); setInterval(() => {}, 1000)" & wait`;

beforeEach(async () => {
  clock = createFakeClock();
  dir = await mkdtemp(join(tmpdir(), 'aw-check-'));
});

describe('检查命令', () => {
  it('在 POSIX shell 中运行（Windows 上为 Git Bash），按退出码判定并保留输出', async () => {
    const result = await service().runCommand(
      dir,
      'if [ 1 -eq 1 ]; then echo checked; fi; exit 3',
      new AbortController().signal,
    );
    expect(result).toMatchObject({ passed: false, exitCode: 3, timedOut: false });
    expect(result.output.trim()).toBe('checked');
  });

  it('超时后结束命令及其子进程，结果为超时未通过', async () => {
    const running = service().runCommand(dir, LONG_RUNNING, new AbortController().signal);
    await created('started');
    clock.advance(ACCEPTANCE_COMMAND_TIMEOUT_MS);
    expect(await running).toMatchObject({ passed: false, exitCode: null, timedOut: true });
  });

  it('中止时结束命令及其子进程', async () => {
    const controller = new AbortController();
    const running = service().runCommand(dir, LONG_RUNNING, controller.signal);
    await created('started');
    controller.abort();
    expect(await running).toMatchObject({ passed: false, timedOut: false });
  });
});
