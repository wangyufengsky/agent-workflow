import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ErrorCode,
  OPENCODE_VERSION,
  RuntimeStatus,
  restartRuntimeOp,
  ServerEventType,
  setHostingAccountOp,
  updateSettingsOp,
} from '@aw/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakeHosting, FAKE_USER, type FakeHosting } from '../../../test/fakes/fake-hosting.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { testCipher } from '../../../test/helpers/cipher.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { isolatedEnv, writeFakeExecutable } from '../../../test/helpers/executables.ts';
import { createTestProxy, type TestProxy } from '../../../test/helpers/proxy.ts';
import { createTestCertificates, type TestCertificates } from '../../../test/helpers/tls.ts';

const TOKEN = 'glpat-valid';
/** A self-hosted GitLab's name that only the test proxy resolves (to this machine). */
const CORP_HOST = 'gitlab.corp.test';

let certificates: TestCertificates;
/** At 127.0.0.1, with a certificate the enterprise CA signed. */
let local: FakeHosting;
/** At CORP_HOST: reachable only through a proxy. */
let corp: FakeHosting;
let t: TestApp | undefined;

beforeAll(async () => {
  certificates = await createTestCertificates([CORP_HOST, '127.0.0.1']);
  const tls = { certPem: certificates.certPem, keyPem: certificates.keyPem };
  local = await createFakeHosting({ token: TOKEN, repos: [], tls });
  corp = await createFakeHosting({ token: TOKEN, repos: [], tls, host: CORP_HOST });
});
afterAll(async () => {
  await local.close();
  await corp.close();
});
afterEach(async () => {
  await t?.close();
  t = undefined;
});

/** Saves a global GitLab token for `hosting`, which first asks the platform who the token is (D155). */
async function saveGitlabToken(app: TestApp, hosting: FakeHosting) {
  return app.call(setHostingAccountOp, { provider: 'gitlab', baseUrl: hosting.endpoints.gitlabUrl, token: TOKEN });
}

describe('后端信任企业 CA（D164）', () => {
  it('企业 CA 签发证书的 GitLab：设置里加上 CA 前证书不受信任，加上后立即可用', async () => {
    t = await createTestApp({ cipher: testCipher });
    const untrusted = await saveGitlabToken(t, local);
    expect(untrusted.raw.json().error).toMatchObject({
      code: ErrorCode.HostingUnreachable,
      details: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' },
    });

    await t.call(updateSettingsOp, { 'network.extraCaCerts': certificates.caPem });
    expect((await saveGitlabToken(t, local)).body).toMatchObject({ account: FAKE_USER });
  });

  it('不是 PEM 证书的内容不保存；带账号密码的代理地址不保存，不论怎么写', async () => {
    t = await createTestApp({ cipher: testCipher });
    const rejected = await t.call(updateSettingsOp, { 'network.extraCaCerts': 'not a certificate' });
    expect(rejected.raw.json().error.code).toBe(ErrorCode.ValidationFailed);
    for (const proxy of [
      'http://alice:secret@proxy.corp.test:8080',
      'HTTP://alice:secret@proxy.corp.test:8080',
      'http:alice:secret@proxy.corp.test:8080',
      'http://proxy.corp.test:8080/@alice',
    ]) {
      expect((await t.call(updateSettingsOp, { 'network.proxy': proxy })).raw.json().error.code).toBe(
        ErrorCode.ValidationFailed,
      );
    }
  });
});

describe('后端出站请求走代理（D165）', () => {
  let fromEnv: TestProxy;
  let fromSettings: TestProxy;
  beforeAll(async () => {
    fromEnv = await createTestProxy();
    fromSettings = await createTestProxy();
  });
  afterAll(async () => {
    await fromEnv.close();
    await fromSettings.close();
  });

  it('默认用环境变量的代理；设置里的代理整体覆盖它；不走代理的地址与回环地址直连', async () => {
    t = await createTestApp({ cipher: testCipher, env: { PATH: process.env.PATH, https_proxy: fromEnv.url } });
    await t.call(updateSettingsOp, { 'network.extraCaCerts': certificates.caPem });
    expect((await saveGitlabToken(t, corp)).body).toMatchObject({ account: FAKE_USER });
    const corpTarget = new URL(corp.endpoints.gitlabUrl).host;
    expect(fromEnv.connects).toEqual([corpTarget]);

    await t.call(updateSettingsOp, { 'network.proxy': fromSettings.url });
    expect((await saveGitlabToken(t, corp)).body).toMatchObject({ account: FAKE_USER });
    expect(fromSettings.connects).toEqual([corpTarget]);

    // The name resolves nowhere but through a proxy.
    await t.call(updateSettingsOp, { 'network.noProxy': ['.corp.test'] });
    expect((await saveGitlabToken(t, corp)).raw.json().error.code).toBe(ErrorCode.HostingUnreachable);
    expect((await saveGitlabToken(t, local)).body).toMatchObject({ account: FAKE_USER });
    expect([fromEnv.connects.length, fromSettings.connects.length]).toEqual([1, 1]);
  });
});

describe('opencode 的证书与代理（D164、D165）', () => {
  let bin: string;
  let launchEnv: string;
  beforeEach(async () => {
    bin = await mkdtemp(join(tmpdir(), 'aw-bin-'));
    launchEnv = join(bin, 'env.json');
    // Records the environment of `serve`, then exits.
    await writeFakeExecutable(
      bin,
      'opencode',
      `import { writeFileSync } from 'node:fs';
if (process.argv[2] === '--version') console.log(${JSON.stringify(OPENCODE_VERSION)});
else { writeFileSync(${JSON.stringify(launchEnv)}, JSON.stringify(process.env)); process.exit(3); }
`,
    );
  });
  const crashed = (app: TestApp) =>
    waitForEvent(app.app.events, ServerEventType.RuntimeUpdated, (r) => r.status === RuntimeStatus.Crashed);

  it('启动 opencode 时带上系统证书库、设置里的 CA 与生效的代理', async () => {
    const env = { ...(await isolatedEnv(bin, bin, { git: true })), HTTPS_PROXY: 'http://env-proxy.corp.test:3128' };
    t = await createTestApp({ env, realOpencode: true });
    await t.call(updateSettingsOp, {
      'network.extraCaCerts': certificates.caPem,
      'network.proxy': 'http://proxy.corp.test:8080',
      'network.noProxy': ['.corp.test'],
    });
    const exited = crashed(t);
    await t.app.start(t.port);
    await exited;

    const launched: NodeJS.ProcessEnv = JSON.parse(await readFile(launchEnv, 'utf8'));
    expect(launched).toMatchObject({
      NODE_USE_SYSTEM_CA: '1',
      HTTPS_PROXY: 'http://proxy.corp.test:8080',
      https_proxy: 'http://proxy.corp.test:8080',
      HTTP_PROXY: 'http://proxy.corp.test:8080',
      NO_PROXY: '.corp.test,localhost,127.0.0.1,[::1]',
    });
    expect(await readFile(launched.NODE_EXTRA_CA_CERTS ?? '', 'utf8')).toContain(certificates.caPem.trim());
  });

  it('写不了 CA 文件时 opencode 不启动、停在 crashed，问题解决后可以重启', async () => {
    t = await createTestApp({ env: await isolatedEnv(bin, bin, { git: true }), realOpencode: true });
    await t.call(updateSettingsOp, { 'network.extraCaCerts': certificates.caPem });
    // A directory where the bundle file goes: writing it fails.
    const bundle = join(t.dataDir, 'network', 'extra-ca.pem');
    await mkdir(bundle, { recursive: true });
    const failed = crashed(t);
    await t.app.start(t.port);
    await failed;
    await expect(readFile(launchEnv, 'utf8')).rejects.toThrow();

    await rm(bundle, { recursive: true });
    const exited = crashed(t);
    expect((await t.call(restartRuntimeOp, {})).status).toBe(200);
    await exited;
    expect(JSON.parse(await readFile(launchEnv, 'utf8'))).toMatchObject({ NODE_EXTRA_CA_CERTS: bundle });
  });
});
