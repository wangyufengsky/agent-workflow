import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OPENCODE_AGENT_NAME, RoleBaseAgent, updateSettingsOp } from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';
import { createTestCertificates } from '../../../test/helpers/tls.ts';

const PROVIDER = 'aw-intranet';
const MODEL = 'intranet';

/** The first chat request reaching an intranet model service whose certificate an enterprise CA signed. */
const reached = Promise.withResolvers<string>();
let model: Server;
let t: TestApp;

beforeAll(async () => {
  const certificates = await createTestCertificates(['127.0.0.1']);
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
          options: { baseURL: `https://127.0.0.1:${(model.address() as AddressInfo).port}/v1`, apiKey: 'unused' },
          models: { [MODEL]: { name: 'Intranet' } },
        },
      },
    }),
  );
  t = await createTestApp({ realOpencode: true, env: { ...process.env, OPENCODE_CONFIG: configFile } });
  await t.call(updateSettingsOp, { 'network.extraCaCerts': certificates.caPem });
  await t.app.start(t.port);
});
afterAll(async () => {
  await t.close();
  model.closeAllConnections();
  await new Promise((resolve) => model.close(resolve));
});

describe('@opencode opencode 信任设置里的 CA（D164）', () => {
  it('企业 CA 签发证书的模型服务：opencode 的请求完成 TLS 握手到达服务', async () => {
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
    await opencode.abort({ sessionId, directory: repo.path });
  });
});
