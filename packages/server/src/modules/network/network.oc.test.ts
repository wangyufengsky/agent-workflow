import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OPENCODE_AGENT_NAME, RoleBaseAgent, updateSettingsOp } from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';
import { createTestProxy, type TestProxy } from '../../../test/helpers/proxy.ts';
import { createTestCertificates } from '../../../test/helpers/tls.ts';

const PROVIDER = 'aw-intranet';
const MODEL = 'intranet';
/** The model service's name, which only the proxy resolves (to this machine). */
const MODEL_HOST = 'model.corp.test';

/** The first chat request reaching an intranet model service whose certificate an enterprise CA signed. */
const reached = Promise.withResolvers<string>();
let model: Server;
let proxy: TestProxy;
let t: TestApp;

beforeAll(async () => {
  const certificates = await createTestCertificates([MODEL_HOST]);
  proxy = await createTestProxy();
  model = createServer({ cert: certificates.certPem, key: certificates.keyPem }, (req, res) => {
    reached.resolve(req.url ?? '');
    res.writeHead(503);
    res.end();
  });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  const configFile = join(await mkdtemp(join(tmpdir(), 'aw-oc-config-')), 'opencode.json');
  await writeFile(
    configFile,
    JSON.stringify({
      provider: {
        [PROVIDER]: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Intranet',
          options: { baseURL: `https://${MODEL_HOST}:${(model.address() as AddressInfo).port}/v1`, apiKey: 'unused' },
          models: { [MODEL]: { name: 'Intranet' } },
        },
      },
    }),
  );
  t = await createTestApp({ realOpencode: true, env: { ...process.env, OPENCODE_CONFIG: configFile } });
  await t.call(updateSettingsOp, { 'network.extraCaCerts': certificates.caPem, 'network.proxy': proxy.url });
  await t.app.start(t.port);
});
afterAll(async () => {
  await t.close();
  model.closeAllConnections();
  await new Promise((resolve) => model.close(resolve));
  await proxy.close();
});

describe('@opencode opencode 信任设置里的 CA、经设置里的代理出站（D164、D174）', () => {
  it('只有代理能解析、企业 CA 签发证书的模型服务：opencode 的请求经转发代理与上游代理完成 TLS 握手到达服务', async () => {
    const opencode = t.app.services.opencode;
    const repo = await createTestRepo();
    const agent = OPENCODE_AGENT_NAME[RoleBaseAgent.Reviewer];
    const sessionId = await opencode.createSession({
      directory: repo.path,
      title: 'Intranet model',
      agent,
      permission: [],
    });
    await opencode.prompt({
      sessionId,
      directory: repo.path,
      agent,
      model: { providerId: PROVIDER, modelId: MODEL },
      text: 'hello',
    });
    expect(await reached.promise).toBe('/v1/chat/completions');
    // opencode may fetch other things through the proxy as well (its model list).
    expect(proxy.connects).toContain(`${MODEL_HOST}:${(model.address() as AddressInfo).port}`);
    await opencode.abort({ sessionId, directory: repo.path });
  });
});
