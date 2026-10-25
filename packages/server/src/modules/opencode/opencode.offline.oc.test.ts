import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OPENCODE_AGENT_NAME, RoleBaseAgent, RuntimeStatus, updateSettingsOp } from '@aw/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';

/**
 * Real opencode 1.19.0 in the offline environment (D168); no model is called. A local server stands in for the
 * internet: `OPENCODE_MODELS_URL` points the models.dev refresh at it and `enterprise.url` the session sharing that
 * the user's `share: "auto"` turns on; it answers 503, so nothing is cached. Online runs are the control: they reach
 * it at the same points where offline runs must not have.
 */
const LOCAL_PROVIDER = 'aw-intranet';

type Recorder = { server: Server; requests: string[]; next(path: string): Promise<void> };

function recorder(): Recorder {
  const requests: string[] = [];
  const waiting: Array<{ path: string; resolve: () => void }> = [];
  const server = createServer((req, res) => {
    const line = `${req.method} ${req.url}`;
    requests.push(line);
    for (const w of waiting.filter((w) => line.includes(w.path))) w.resolve();
    res.writeHead(503).end();
  });
  return {
    server,
    requests,
    next: (path) =>
      requests.some((r) => r.includes(path))
        ? Promise.resolve()
        : new Promise((resolve) => waiting.push({ path, resolve })),
  };
}

let internet: Recorder;
let configFile: string;
let modelsUrl: string;
let xdg: Record<string, string>;
let t: TestApp;
beforeAll(async () => {
  internet = recorder();
  await new Promise<void>((resolve) => internet.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(internet.server.address() as AddressInfo).port}`;
  modelsUrl = base;
  const root = await mkdtemp(join(tmpdir(), 'aw-oc-offline-'));
  xdg = Object.fromEntries(['DATA', 'CONFIG', 'CACHE', 'STATE'].map((k) => [`XDG_${k}_HOME`, join(root, k)]));
  configFile = join(root, 'opencode.json');
  await writeFile(
    configFile,
    JSON.stringify({
      share: 'auto',
      enterprise: { url: base },
      // An intranet provider stays: it is never called here.
      provider: {
        [LOCAL_PROVIDER]: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Intranet',
          options: { baseURL: 'http://127.0.0.1:9/v1', apiKey: 'unused' },
          models: { model: { name: 'Intranet model' } },
        },
      },
    }),
  );
});
afterEach(async () => {
  await t.close();
  internet.requests.length = 0;
});
afterAll(() => new Promise((resolve) => internet.server.close(resolve)));

async function startApp(offline: boolean): Promise<void> {
  t = await createTestApp({
    realOpencode: true,
    env: { ...process.env, ...xdg, OPENCODE_CONFIG: configFile, OPENCODE_MODELS_URL: modelsUrl },
  });
  await t.call(updateSettingsOp, { 'network.offline': offline });
  await t.app.start(t.port);
}

async function createSession(): Promise<void> {
  const repo = await createTestRepo();
  await t.app.services.opencode.createSession({
    directory: repo.path,
    title: 'offline',
    agent: OPENCODE_AGENT_NAME[RoleBaseAgent.Executor],
    permission: [],
  });
}

const providersOf = async () =>
  new Set((await t.app.services.opencode.listModels()).available.map((m) => m.providerId));

describe('@opencode 离线环境', () => {
  it('在线时（对照）：刷新 models.dev、自动分享会话，列出自带的 opencode provider', async () => {
    await startApp(false);
    await internet.next('/api.json');
    expect(await providersOf()).toContain('opencode');
    await createSession();
    await internet.next('/api/share');
  });

  it('离线时：不刷新 models.dev、不分享会话，只列出用户配置的 provider', async () => {
    await startApp(true);
    expect(await t.app.services.runtime.snapshot()).toMatchObject({ status: RuntimeStatus.Ready, offline: true });
    const providers = await providersOf();
    expect(providers).toContain(LOCAL_PROVIDER);
    expect(providers).not.toContain('opencode');
    expect(providers).not.toContain('opencode-go');
    await createSession();
    // Online, both requests have arrived by now (the refresh before opencode listens, sharing as the session is made).
    expect(internet.requests).toEqual([]);
  });
});
