import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvironmentOp, OPENCODE_VERSION, recheckEnvironmentOp, updateSettingsOp } from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';

const REAL_GIT = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

let bin: string;
let home: string;
let t: TestApp;

async function fakeOpencode(dir: string, version: string): Promise<string> {
  const file = join(dir, 'opencode');
  await writeFile(file, `#!/bin/sh\necho ${version}\n`);
  await chmod(file, 0o755);
  return file;
}

/** App whose PATH holds only our fake bin dir (with git linked in) and whose HOME has no ~/.opencode. */
async function appWithPath(options: { git: boolean }) {
  if (options.git) await symlink(REAL_GIT, join(bin, 'git'));
  t = await createTestApp({ env: { PATH: bin, HOME: home } });
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
