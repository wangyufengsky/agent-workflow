import type { FunctionalTestServicePlan, FunctionalTestServiceRuntime } from '@aw/shared';
import { expect, it } from 'vitest';
import { createTestRepo } from '../../../test/helpers/git.ts';
import { systemClock } from '../../core/clock.ts';
import { startServiceGroup } from './previews.service-group.ts';

const packageJson = JSON.stringify({ scripts: { start: 'node server.mjs' } });
const upstream = `
  import { createServer } from 'node:http';
  if (process.env.UPSTREAM_URL != null) throw new Error('Undeclared dependency URL leaked');
  console.log('upstream-only secret=upstream-secret');
  createServer((_req, res) => res.end('upstream-ready')).listen(Number(process.env.PORT), process.env.HOST);
`;
const downstream = `
  import { createServer } from 'node:http';
  const response = await fetch(process.env.UPSTREAM_URL + '/health');
  if (await response.text() !== 'upstream-ready') throw new Error('Upstream not ready');
  console.log('downstream-only');
  createServer((_req, res) => res.end(process.env.UPSTREAM_URL)).listen(Number(process.env.PORT), process.env.HOST);
`;
async function fixture(targetCode = downstream, moreFiles: Record<string, string> = {}) {
  const repo = await createTestRepo({
    files: {
      'api/package.json': packageJson,
      'api/server.mjs': targetCode,
      'store/package.json': packageJson,
      'store/server.mjs': upstream,
      ...moreFiles,
    },
  });
  const launch = (directory: string) => ({
    directory,
    source: `${directory}/package.json`,
    script: 'start',
    readyPath: '/health',
  });
  const plan: FunctionalTestServicePlan = {
    targetServiceId: 'api',
    services: [
      { id: 'api', launch: launch('api'), dependsOn: ['store'], inject: [{ env: 'UPSTREAM_URL', serviceId: 'store' }] },
      { id: 'store', launch: launch('store'), dependsOn: [], inject: [] },
    ],
  };
  return {
    plan,
    worktree: { path: repo.path, baseCommit: await repo.git('rev-parse', 'HEAD') },
    env: { ...process.env, UPSTREAM_URL: 'http://example.invalid' },
    clock: systemClock,
  };
}

it('starts dependency first, injects its live origin, and keeps independent readiness and redacted logs', async () => {
  const controller = new AbortController();
  const group = await startServiceGroup({ ...(await fixture()), signal: controller.signal });
  try {
    const [store, api] = group.snapshot();
    if (store?.target == null || api?.target == null) throw new Error('Expected both service addresses');
    expect(store.readyStatus).toBe(200);
    expect(api.readyStatus).toBe(200);
    expect(store.target).not.toBe(api.target);
    expect(group.target).toBe(api.target);
    expect(await (await fetch(group.target)).text()).toBe(store.target);
    expect(store.logTail).toContain('upstream-only secret=[redacted]');
    expect(store.logTail).not.toContain('downstream-only');
    expect(api.logTail).toContain('downstream-only');
    expect(api.logTail).not.toContain('upstream-secret');
    expect(api.diagnostics).toMatchObject({
      workingDirectory: 'api',
      manager: 'npm',
      injectedEnvironment: ['UPSTREAM_URL'],
    });
    controller.abort();
    await group.exited;
    await expect(fetch(store.target)).rejects.toThrow();
    await expect(fetch(api.target)).rejects.toThrow();
  } finally {
    await group.stop();
  }
});

it.each(['readiness failure', 'cancel'] as const)('releases a started dependency after downstream %s', async (mode) => {
  const controller = new AbortController();
  const code = `
    import { createServer } from 'node:http';
    createServer((_req, res) => res.writeHead(404).end()).listen(Number(process.env.PORT), process.env.HOST);
  `;
  let latest: FunctionalTestServiceRuntime[] = [];
  const promise = startServiceGroup({
    ...(await fixture(code)),
    signal: controller.signal,
    update(services) {
      latest = services;
      if (mode === 'cancel' && services.find(({ id }) => id === 'api')?.readyUrl != null) controller.abort();
    },
  });
  await expect(promise).rejects.toThrow(mode === 'cancel' ? /stopped|abort/i : /readiness path returned HTTP 404/i);
  const store = latest.find(({ id }) => id === 'store');
  if (store?.target == null) throw new Error('Expected the dependency to have started');
  expect(store.readyStatus).toBe(200);
  await expect(fetch(store.target)).rejects.toThrow();
});

it('rejects a cycle before starting a process', async () => {
  const input = await fixture();
  const store = input.plan.services.find(({ id }) => id === 'store');
  if (store === undefined) throw new Error('Expected fixture store');
  store.dependsOn.push('api');
  const controller = new AbortController();
  await expect(startServiceGroup({ ...input, signal: controller.signal })).rejects.toThrow(/cycle/);
});

const peer = (status: number) => `
  import { createServer } from 'node:http';
  import { writeFile } from 'node:fs/promises';
  const server = createServer((_req, res) => res.writeHead(${status}).end());
  server.listen(Number(process.env.PORT), process.env.HOST, async () => {
    await writeFile(new URL('../peer-listening', import.meta.url), 'yes');
  });
`;
const apiWaitingForPeer = (status: number) => `
  import { createServer } from 'node:http';
  import { existsSync } from 'node:fs';
  createServer((_req, res) => {
    const peerOnline = existsSync(new URL('../peer-listening', import.meta.url));
    res.writeHead(peerOnline ? ${status} : 503).end();
  }).listen(Number(process.env.PORT), process.env.HOST);
`;

async function parallelFixture(apiStatus: number, peerStatus: number) {
  const input = await fixture(apiWaitingForPeer(apiStatus), {
    'peer/package.json': packageJson,
    'peer/server.mjs': peer(peerStatus),
  });
  input.plan.services.push({
    id: 'peer',
    launch: { source: 'peer/package.json', directory: 'peer', script: 'start', readyPath: '/health' },
    dependsOn: ['store'],
    inject: [],
  });
  return input;
}

it('starts independent branches concurrently after their dependency is ready', async () => {
  const controller = new AbortController();
  const input = await parallelFixture(200, 200);
  const group = await startServiceGroup({ ...input, signal: controller.signal });
  try {
    expect(group.snapshot().map(({ readyStatus }) => readyStatus)).toEqual([200, 200, 200]);
    const addresses = group.snapshot().map(({ target }) => target);
    expect(new Set(addresses).size).toBe(3);
  } finally {
    await group.stop();
  }
});

it.each(['fail', 'cancel'] as const)('waits for all ready and starting children during parallel %s', async (mode) => {
  const controller = new AbortController();
  const input = await parallelFixture(mode === 'fail' ? 404 : 503, 503);
  let latest: FunctionalTestServiceRuntime[] = [];
  const pending = startServiceGroup({
    ...input,
    signal: controller.signal,
    update(services) {
      latest = services;
      if (
        mode === 'cancel' &&
        services.find(({ id }) => id === 'peer')?.readyStatus === 503 &&
        services.find(({ id }) => id === 'api')?.readyStatus === 503
      )
        controller.abort();
    },
  });
  await expect(pending).rejects.toThrow(mode === 'fail' ? /Service api:.*404/ : /stopped|abort/i);
  for (const { target } of latest) {
    if (target == null) throw new Error('Expected a started process to have an address');
    await expect(fetch(target)).rejects.toThrow();
  }
});

it('stops the remaining services when a ready dependency exits', async () => {
  const input = await fixture(downstream, {
    'store/server.mjs': upstream.replace(
      "res.end('upstream-ready')",
      `{
      res.end('upstream-ready');
      if (_req.url === '/exit') process.exit(2);
    }`,
    ),
  });
  const controller = new AbortController();
  const group = await startServiceGroup({ ...input, signal: controller.signal });
  try {
    const store = group.snapshot().find(({ id }) => id === 'store');
    if (store?.target == null) throw new Error('Expected an upstream URL');
    // Closing the process can end the socket before the response is received.
    await fetch(new URL('/exit', store.target)).catch(() => {});
    await group.exited;
    expect(group.failure()?.message).toMatch(/Service store: process exited/);
    await expect(fetch(group.target)).rejects.toThrow();
  } finally {
    await group.stop();
  }
});
