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
import { addProject } from '../../../test/helpers/tasks.ts';

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
    expect(body.opencode).toEqual({ status: 'not_installed' });
    expect(body.ready).toBe(false);
  });

  it('opencode 版本不在支持范围内时为 version_mismatch 并报告版本与路径', async () => {
    const path = await fakeOpencode(bin, '1.17.9');
    await appWithPath({ git: true });
    const { body } = await t.call(getEnvironmentOp, {});
    expect(body.opencode).toEqual({ status: 'version_mismatch', path, version: '1.17.9' });
    expect(body.ready).toBe(false);
  });

  it('安装支持范围内的版本后重新检测变为 stopped 且环境就绪', async () => {
    await appWithPath({ git: true });
    expect((await t.call(getEnvironmentOp, {})).body.opencode.status).toBe('not_installed');

    const installed = await fakeOpencode(bin, '1.18.2');
    const { body } = await t.call(recheckEnvironmentOp, {});
    expect(body.opencode).toMatchObject({ status: 'stopped', path: installed, version: '1.18.2' });
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
    expect(body).toMatchObject({ git: { installed: false }, ready: false });
  });
});

describe('可用的模型（D162）', () => {
  it('只写在项目 opencode 配置里的 provider 也算可用，注明所属项目；没有声明上下文长度的为 null', async () => {
    t = await createTestApp();
    // The intranet provider is configured in the repository only, not in the user's global configuration.
    t.fake.models.splice(0);
    expect((await t.call(getEnvironmentOp, {})).body).toMatchObject({ models: { available: [] }, ready: false });

    const { project } = await addProject(t);
    t.fake.projectModels.set(project.repoPath, [
      { providerId: 'lan', modelId: 'qwen-coder', name: 'Qwen Coder', contextLimit: null },
    ]);
    const { body } = await t.call(getEnvironmentOp, {});
    expect(body.models.available).toEqual([
      { providerId: 'lan', modelId: 'qwen-coder', name: 'Qwen Coder', contextLimit: null, projectIds: [project.id] },
    ]);
    expect(body.ready).toBe(true);
  });

  it('全局配置里的模型不注明项目，项目里同名的不重复列出', async () => {
    t = await createTestApp();
    const global = { providerId: 'lan', modelId: 'qwen-coder', name: 'Qwen Coder', contextLimit: 32_768 };
    t.fake.models.splice(0, Infinity, global);
    const { project } = await addProject(t);
    t.fake.projectModels.set(project.repoPath, [global]);
    expect((await t.call(getEnvironmentOp, {})).body.models.available).toEqual([{ ...global, projectIds: [] }]);
  });
});

describe('凭据存储（D74）', () => {
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
