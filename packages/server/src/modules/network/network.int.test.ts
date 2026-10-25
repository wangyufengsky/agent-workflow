import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createProjectOp,
  ErrorCode,
  gitFetchOp,
  gitPushOp,
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
import { createTestRepo } from '../../../test/helpers/git.ts';
import { createGitHttpServer } from '../../../test/helpers/git-http.ts';
import { createTestProxy, type TestProxy } from '../../../test/helpers/proxy.ts';
import { createTestCertificates, type TestCertificates } from '../../../test/helpers/tls.ts';
import { runGit } from '../git/index.ts';

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

/** The status a proxy answers `CONNECT target` with, given the credentials of `proxyUrl`. */
async function tunnel(proxyUrl: string, target: string): Promise<number | undefined> {
  const proxy = new URL(proxyUrl);
  const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
  return new Promise((resolve, reject) => {
    const req = request({
      host: proxy.hostname,
      port: proxy.port,
      method: 'CONNECT',
      path: target,
      headers:
        proxy.username === '' ? {} : { 'proxy-authorization': `Basic ${Buffer.from(credentials).toString('base64')}` },
    });
    req.on('connect', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
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

let fromEnv: TestProxy;
let fromSettings: TestProxy;
beforeEach(async () => {
  fromEnv = await createTestProxy();
  fromSettings = await createTestProxy();
});
afterEach(async () => {
  await fromEnv.close();
  await fromSettings.close();
});

describe('后端出站请求走代理（D165、D174）', () => {
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

  it('不走代理的网段（Node 自己不认）：按 IP 访问的 GitLab 直连', async () => {
    // An address in 127.0.0.0/8 that the loopback entries do not name: only the network can send it direct.
    const byIp = await createFakeHosting({ token: TOKEN, repos: [], host: '[::ffff:127.0.0.1]' });
    t = await createTestApp({ cipher: testCipher, env: { PATH: process.env.PATH } });
    await t.call(updateSettingsOp, { 'network.proxy': fromSettings.url, 'network.noProxy': ['127.0.0.0/8'] });
    expect((await saveGitlabToken(t, byIp)).body).toMatchObject({ account: FAKE_USER });
    expect(fromSettings.connects).toEqual([]);
    await byIp.close();
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

  it('启动 opencode 时带上系统证书库、设置里的 CA，代理换成后端的转发代理，由它按 noProxy 的网段分流', async () => {
    const env = { ...(await isolatedEnv(bin, bin, { git: true })), HTTPS_PROXY: 'http://env-proxy.corp.test:3128' };
    t = await createTestApp({ env, realOpencode: true });
    await t.call(updateSettingsOp, {
      'network.extraCaCerts': certificates.caPem,
      'network.proxy': fromSettings.url,
      'network.noProxy': ['127.0.0.0/8'],
    });
    const exited = crashed(t);
    await t.app.start(t.port);
    await exited;

    const launched: NodeJS.ProcessEnv = JSON.parse(await readFile(launchEnv, 'utf8'));
    expect(launched).toMatchObject({ NODE_USE_SYSTEM_CA: '1', NO_PROXY: 'localhost,127.0.0.1,[::1]' });
    expect(await readFile(launched.NODE_EXTRA_CA_CERTS ?? '', 'utf8')).toContain(certificates.caPem.trim());
    const forward = launched.HTTPS_PROXY ?? '';
    expect([launched.https_proxy, launched.HTTP_PROXY]).toEqual([forward, launched.http_proxy]);
    const port = new URL(corp.endpoints.gitlabUrl).port;
    // Through the upstream proxy, which alone resolves the name; an address in the network goes direct.
    expect(await tunnel(forward, `${CORP_HOST}:${port}`)).toBe(200);
    expect(await tunnel(forward, `[::ffff:127.0.0.1]:${port}`)).toBe(200);
    expect(fromSettings.connects).toEqual([`${CORP_HOST}:${port}`]);
    // Only opencode and git are told how to use it.
    expect(await tunnel(`http://${new URL(forward).host}`, `${CORP_HOST}:${port}`)).toBe(407);
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

describe('git 推拉用应用的 CA 与代理（D175）', () => {
  /** A project whose origin is the bare repository `name` served over HTTPS at `url`, with `main` to push. */
  async function projectWithOrigin(app: TestApp, url: (name: string) => string, root: string, name: string) {
    await runGit(['init', '-q', '--bare', join(root, name)], { cwd: root });
    const repo = await createTestRepo({ origin: url(name) });
    const { body } = await app.call(createProjectOp, { repoPath: repo.path });
    return { id: body.id, repo, bare: join(root, name) };
  }

  it('企业 CA 签发证书的远端：设置里加上 CA 前推送因证书失败，加上后推送与取回都成功', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aw-git-http-'));
    const server = await createGitHttpServer({ root, tls: certificates });
    t = await createTestApp({ cipher: testCipher });
    const project = await projectWithOrigin(t, server.url, root, 'origin.git');

    const untrusted = await t.call(gitPushOp, { id: project.id, branch: 'main' });
    expect(untrusted.raw.json().error).toMatchObject({ code: ErrorCode.GitCommandFailed });
    // OpenSSL's git says "SSL certificate problem", GnuTLS's (Debian, Ubuntu) "server certificate verification failed".
    expect(untrusted.raw.json().error.details.stderr).toMatch(/certificate/);

    await t.call(updateSettingsOp, { 'network.extraCaCerts': certificates.caPem });
    expect((await t.call(gitPushOp, { id: project.id, branch: 'main' })).status).toBe(204);
    expect((await runGit(['rev-parse', 'main'], { cwd: project.bare })).stdout).toBe(
      (await project.repo.git('rev-parse', 'main')).trim(),
    );
    expect((await t.call(gitFetchOp, { id: project.id })).status).toBe(204);
    await server.close();
  });

  it('设置里的代理：推送与取回经代理到达只有代理能解析的远端', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aw-git-http-'));
    const server = await createGitHttpServer({ root, tls: certificates, host: CORP_HOST });
    t = await createTestApp({ cipher: testCipher });
    await t.call(updateSettingsOp, { 'network.extraCaCerts': certificates.caPem, 'network.proxy': fromSettings.url });
    const project = await projectWithOrigin(t, server.url, root, 'origin.git');

    expect((await t.call(gitPushOp, { id: project.id, branch: 'main' })).status).toBe(204);
    expect((await t.call(gitFetchOp, { id: project.id })).status).toBe(204);
    const target = new URL(server.url('origin.git')).host;
    expect(fromSettings.connects).toEqual([target, target]);
    await server.close();
  });

  it('http 远端：经代理转发到只有代理能解析的远端；不走代理的网段里按 IP 写的远端直连', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aw-git-http-'));
    const corpServer = await createGitHttpServer({ root, host: CORP_HOST });
    const byIp = await createGitHttpServer({ root, host: '[::ffff:127.0.0.1]' });
    t = await createTestApp({ cipher: testCipher });
    await t.call(updateSettingsOp, { 'network.proxy': fromSettings.url, 'network.noProxy': ['127.0.0.0/8'] });
    const proxied = await projectWithOrigin(t, corpServer.url, root, 'proxied.git');
    const direct = await projectWithOrigin(t, byIp.url, root, 'direct.git');

    expect((await t.call(gitPushOp, { id: proxied.id, branch: 'main' })).status).toBe(204);
    expect((await t.call(gitPushOp, { id: direct.id, branch: 'main' })).status).toBe(204);
    expect((await runGit(['rev-parse', 'main'], { cwd: direct.bare })).stdout).toBe(
      (await direct.repo.git('rev-parse', 'main')).trim(),
    );
    // A push is two requests (refs, then the pack); only the proxied remote's reached the proxy.
    const target = new URL(corpServer.url('proxied.git')).host;
    expect(fromSettings.forwards).toEqual([target, target]);
    await corpServer.close();
    await byIp.close();
  });
});
