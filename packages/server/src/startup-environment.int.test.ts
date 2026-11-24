import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { rootCertificates } from 'node:tls';
import { fileURLToPath } from 'node:url';
import {
  getRuntimeOp,
  RuntimeStatus,
  restartRuntimeOp,
  setStartupEnvironmentOp,
  setupMasterPasswordOp,
  toOperationRequest,
  UiMode,
  unlockCredentialsOp,
  updateSettingsOp,
} from '@aw/shared';
import { execa } from 'execa';
import { expect, it, vi } from 'vitest';
import { createTestApp, TEST_TOKEN } from '../test/helpers/app.ts';
import { testCipher } from '../test/helpers/cipher.ts';
import { writeFakeExecutable } from '../test/helpers/executables.ts';
import { DATABASE_FILE } from './core/db/database.ts';
import { host } from './core/platform.ts';
import { unavailableCipher } from './modules/credentials/index.ts';
import { desktopBackendEnvironment } from './startup-environment.ts';

const plainName = 'AW_TEST_RUNTIME_SETTING';
const secretName = 'AW_TEST_RUNTIME_SECRET';
const password = 'fixture master password';

it('loads no database on first launch and is read-only on a database predating startup settings', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'aw-startup-empty-'));
  const inherited = { PATH: 'inherited' };
  expect(await desktopBackendEnvironment(dataDir, inherited, testCipher)).toEqual(inherited);
  await expect(readFile(join(dataDir, DATABASE_FILE))).rejects.toMatchObject({ code: 'ENOENT' });
  const file = join(dataDir, DATABASE_FILE);
  const old = new DatabaseSync(file);
  old.exec('CREATE TABLE old_settings (name TEXT PRIMARY KEY)');
  old.close();
  const before = await readFile(file);
  expect(await desktopBackendEnvironment(dataDir, inherited, testCipher)).toEqual(inherited);
  expect(await readFile(file)).toEqual(before);
});

it('sets a startup-only Node CA and a keychain secret before a real child initializes', async () => {
  const backend = await createTestApp({ cipher: testCipher });
  try {
    const ca = rootCertificates[0];
    if (ca === undefined) throw new Error('Test Node build has no bundled certificate');
    const caFile = join(backend.dataDir, 'extra.pem');
    await writeFile(caFile, ca);
    await backend.call(updateSettingsOp, { 'ui.mode': UiMode.Pro });
    const saved = await backend.call(setStartupEnvironmentOp, {
      items: [
        { name: plainName, secret: false, value: 'saved' },
        { name: secretName, secret: true, value: 'fixture-keychain-value' },
        { name: 'NODE_EXTRA_CA_CERTS', secret: false, value: caFile },
        { name: 'NODE_OPTIONS', secret: false, value: '--trace-deprecation' },
      ],
    });
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain('fixture-keychain-value');
    const inherited = {
      ...process.env,
      [plainName]: 'login-value',
      [secretName]: 'login-secret',
      NODE_OPTIONS: '--no-deprecation',
    };
    const resolved = await desktopBackendEnvironment(backend.dataDir, inherited, testCipher);
    expect(resolved.NODE_OPTIONS).toBe('--no-deprecation');
    const child = await execa(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import {getCACertificates} from 'node:tls';
      console.log(JSON.stringify({
        value: process.env[${JSON.stringify(plainName)}],
        secret: process.env[${JSON.stringify(secretName)}],
        extra: getCACertificates('extra').length
      }));
    `,
      ],
      { env: resolved, extendEnv: false },
    );
    expect(JSON.parse(child.stdout)).toEqual({ value: 'saved', secret: 'fixture-keychain-value', extra: 1 });
    expect(inherited[plainName]).toBe('login-value');
    expect(process.env[plainName]).not.toBe('saved');
  } finally {
    await backend.close();
  }
});

it('applies saved values after a real backend restart and supplies unlocked secrets only to later child launches', async () => {
  const setup = await createTestApp({ cipher: unavailableCipher });
  const { dataDir } = setup;
  const observations = join(dataDir, 'child-environment.jsonl');
  const bin = join(dataDir, 'bin');
  await mkdir(bin);
  const executable = await writeFakeExecutable(
    bin,
    'opencode',
    `
    import { appendFile } from 'node:fs/promises';
    import { createServer } from 'node:http';
    if (process.argv.includes('--version')) console.log('1.19.0');
    else {
      await appendFile(${JSON.stringify(observations)}, JSON.stringify({
        value: process.env[${JSON.stringify(plainName)}],
        secret: process.env[${JSON.stringify(secretName)}] ?? null,
        extraSetting: process.env.AW_TEST_NEXT_RESTART ?? null,
        nodeOptions: process.env.NODE_OPTIONS,
      }) + '\\n');
      const server = createServer((req, res) => {
        if (req.url === '/global/event') res.writeHead(200, { 'content-type': 'text/event-stream' }).write(': ready\\n\\n');
        else res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      });
      server.listen(0, '127.0.0.1', () => console.log('listening on http://127.0.0.1:' + server.address().port));
    }
  `,
  );
  try {
    await setup.call(updateSettingsOp, { 'ui.mode': UiMode.Pro, 'opencode.binaryPath': executable });
    expect((await setup.call(setupMasterPasswordOp, { password })).status).toBe(200);
    expect(
      (
        await setup.call(setStartupEnvironmentOp, {
          items: [
            { name: plainName, secret: false, value: 'on-restart' },
            { name: secretName, secret: true, value: 'master-key-value' },
            { name: 'PATH', secret: false, value: [bin, ...host.pathDirs(process.env)].join(delimiter) },
            { name: 'NODE_OPTIONS', secret: false, value: '--trace-deprecation' },
          ],
        })
      ).status,
    ).toBe(200);
  } finally {
    await setup.close();
  }
  const inherited = {
    ...process.env,
    AW_DATA_DIR: dataDir,
    AW_PORT: '0',
    AW_API_TOKEN: TEST_TOKEN,
    NODE_ENV: 'production',
    [plainName]: 'old-shell-value',
    [secretName]: 'old-shell-secret',
    NODE_OPTIONS: '--no-deprecation',
  };
  const beforeFork = await desktopBackendEnvironment(dataDir, inherited, unavailableCipher);
  expect(beforeFork[secretName]).toBeUndefined();

  // Deliberately pass login values to plain Node: the real backend must resolve its own snapshot.
  const child = fork(fileURLToPath(new URL('./main.ts', import.meta.url)), [], {
    env: inherited,
    execArgv: [],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const stopped = once(child, 'exit');
  try {
    const port = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`Backend exited before listening with code ${code}`)));
      child.on('message', (message: { type?: string; port: number }) => {
        if (message.type === 'ready') resolve(message.port);
      });
    });
    const runtimeUrl = `http://127.0.0.1:${port}`;
    const call = async (req: { method: string; url: string; body?: unknown }) => {
      const response = await fetch(runtimeUrl + req.url, {
        method: req.method,
        headers: {
          authorization: `Bearer ${TEST_TOKEN}`,
          ...(req.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(req.body === undefined ? {} : { body: JSON.stringify(req.body) }),
      });
      return { status: response.status, body: await response.json() };
    };
    const observed = async () =>
      (await readFile(observations, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    await vi.waitFor(async () => {
      expect((await call(toOperationRequest(getRuntimeOp, {}))).body).toMatchObject({ status: RuntimeStatus.Ready });
    });
    expect(await observed()).toEqual([
      { value: 'on-restart', secret: null, extraSetting: null, nodeOptions: '--trace-deprecation' },
    ]);
    expect(
      (
        await call(
          toOperationRequest(setStartupEnvironmentOp, {
            items: [
              { name: plainName, secret: false, value: 'another-restart' },
              { name: secretName, secret: true },
              { name: 'AW_TEST_NEXT_RESTART', secret: false, value: 'only-after-full-restart' },
            ],
          }),
        )
      ).status,
    ).toBe(200);
    expect((await call(toOperationRequest(unlockCredentialsOp, { password }))).status).toBe(200);
    expect(await observed()).toHaveLength(1);
    expect((await call(toOperationRequest(restartRuntimeOp, {}))).status).toBe(200);
    expect(await observed()).toEqual([
      { value: 'on-restart', secret: null, extraSetting: null, nodeOptions: '--trace-deprecation' },
      { value: 'on-restart', secret: 'master-key-value', extraSetting: null, nodeOptions: '--trace-deprecation' },
    ]);
  } finally {
    if (child.connected) child.disconnect();
    await stopped;
  }
});
