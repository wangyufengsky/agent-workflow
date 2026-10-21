import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getEnvironmentOp,
  getRuntimeLogsOp,
  OPENCODE_VERSION,
  recheckEnvironmentOp,
  updateSettingsOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { testCipher } from '../../../test/helpers/cipher.ts';
import { isolatedEnv, writeFakeVersion } from '../../../test/helpers/executables.ts';

let bin: string;
let home: string;
let t: TestApp;

const fakeOpencode = (dir: string, version: string) => writeFakeVersion(dir, 'opencode', version);

/** App whose PATH holds only our fake bin dir (and git) and whose home has no .opencode. */
async function appWithPath(options: { git: boolean }) {
  t = await createTestApp({ env: await isolatedEnv(bin, home, options) });
}

beforeEach(async () => {
  bin = await mkdtemp(join(tmpdir(), 'aw-bin-'));
  home = await mkdtemp(join(tmpdir(), 'aw-home-'));
});
afterEach(() => t.close());

describe('环境检测', () => {
  it('PATH 与 ~/.opencode/bin 中都没有 opencode 时为 not_installed', async () => {
    await appWithPath({ git: true });
    const { body } = await t.call(getEnvironmentOp, {});
    expect(body.git).toEqual({ installed: true, version: expect.stringMatching(/^\d+\.\d+/) });
    expect(body.opencode).toEqual({ status: 'not_installed', requiredVersion: OPENCODE_VERSION });
    expect(body.ready).toBe(false);
  });

  it('opencode 版本不是 1.19.0 时为 version_mismatch 并报告版本与路径', async () => {
    const path = await fakeOpencode(bin, '1.18.2');
    await appWithPath({ git: true });
    const { body } = await t.call(getEnvironmentOp, {});
    expect(body.opencode).toEqual({ status: 'version_mismatch', path, version: '1.18.2', requiredVersion: '1.19.0' });
    expect(body.ready).toBe(false);
  });

  it('安装正确版本后重新检测变为 stopped 且环境就绪', async () => {
    await appWithPath({ git: true });
    expect((await t.call(getEnvironmentOp, {})).body.opencode.status).toBe('not_installed');

    const installed = await fakeOpencode(bin, OPENCODE_VERSION);
    const { body } = await t.call(recheckEnvironmentOp, {});
    expect(body.opencode).toMatchObject({ status: 'stopped', path: installed, version: OPENCODE_VERSION });
    expect(body.ready).toBe(true);
  });

  it('设置了 opencode.binaryPath 时只使用该路径', async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), 'aw-oc-'));
    const configured = await fakeOpencode(elsewhere, OPENCODE_VERSION);
    await fakeOpencode(bin, '1.0.0');
    await appWithPath({ git: true });
    await t.call(updateSettingsOp, { 'opencode.binaryPath': configured });
    const { body } = await t.call(recheckEnvironmentOp, {});
    expect(body.opencode).toMatchObject({ status: 'stopped', path: configured });
  });

  it('PATH 中没有 git 时 git 未安装', async () => {
    await appWithPath({ git: false });
    const { body } = await t.call(getEnvironmentOp, {});
    expect(body.git).toEqual({ installed: false });
    expect(body.ready).toBe(false);
  });
});

describe('凭据存储（D69）', () => {
  it('报告能否保存令牌与密码；不可用不影响环境就绪', async () => {
    await fakeOpencode(bin, OPENCODE_VERSION);
    const env = await isolatedEnv(bin, home, { git: true });
    t = await createTestApp({ env, cipher: testCipher });
    expect((await t.call(getEnvironmentOp, {})).body.credentials).toEqual({ available: true });

    // No encryption backend (Linux without a secret service): the store is unavailable, the rest still ready.
    await t.close();
    t = await createTestApp({ env });
    expect((await t.call(getEnvironmentOp, {})).body).toMatchObject({ credentials: { available: false }, ready: true });
  });
});

describe('运行环境日志（M5-08）', () => {
  it('返回最新一天 opencode 日志的末尾若干行；还没有日志时为空', async () => {
    await appWithPath({ git: true });
    expect((await t.call(getRuntimeLogsOp, {})).body).toEqual({ file: null, lines: [] });
    const logs = join(t.dataDir, 'logs');
    await mkdir(logs, { recursive: true });
    await writeFile(join(logs, 'opencode-20261019.log'), 'old\n');
    await writeFile(join(logs, 'opencode-20261020.log'), 'one\ntwo\nthree\n');
    await writeFile(join(logs, 'app-20261021.log'), 'not opencode\n');
    expect((await t.call(getRuntimeLogsOp, { tail: 2 })).body).toEqual({
      file: 'opencode-20261020.log',
      lines: ['two', 'three'],
    });
  });
});
