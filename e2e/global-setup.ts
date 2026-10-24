import { execSync, fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { DEV_PORT_ENV, devPorts } from '@aw/shared';
import { redirectTmpdir } from '../packages/server/test/helpers/temp.ts';
import { E2E_HOSTING, E2E_TOKEN } from './env.ts';

/**
 * Starts the one backend every browser spec runs against (so specs run one at a time against its state). It listens
 * on a port the system picks, unless `AW_DEV_API_PORT` sets one, and reports it once listening: no other process can
 * take the port between choosing and listening, and checkouts run E2E side by side (D78). Workers start after this
 * and inherit the runner's environment, so the port reaches baseURL and `API_BASE` through `AW_DEV_API_PORT`.
 */
function playwrightBrowsers(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (process.platform === 'win32')
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright');
  return join(homedir(), '.cache', 'ms-playwright');
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  // Every temporary directory of the run (the backend's home below, the specs' repositories and Electron profiles,
  // those of the processes they start) lands in one directory, which workers inherit with the environment and which
  // goes once the backend has exited.
  const temp = redirectTmpdir('aw-e2e-');
  const home = mkdtempSync(join(tmpdir(), 'aw-e2e-home-'));
  const webDir = join(home, 'web');
  // In CI the backend's log goes to the job log, next to a failing spec.
  const stdout = process.env.CI === undefined ? 'ignore' : 'inherit';
  // Windows spells it `Path`; a second, differently cased key would be ambiguous for the backend.
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  const env = {
    ...process.env,
    // The browser module's development host (29 §5.2) finds Playwright's browsers by HOME, which is replaced below:
    // point it at their default place (Playwright's documented cache directory of each platform).
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? playwrightBrowsers(),
    VITE_AW_API_TOKEN: E2E_TOKEN,
    AW_WEB_DIR: webDir,
    AW_API_TOKEN: E2E_TOKEN,
    AW_DATA_DIR: join(home, 'data'),
    AW_PORT: String(devPorts(process.env, { api: 0 }).api),
    // In CI the state transitions with their timestamps show where a slow platform spends its time (17 §4.1).
    AW_LOG_LEVEL: process.env.CI === undefined ? 'warn' : 'info',
    NODE_ENV: 'development',
    // AI sessions are played by FakeOpencode (07 §2), which also reports a model so the environment is ready.
    AW_FAKE_OPENCODE: '1',
    // Pull requests and their reviewers are played by FakeHosting (07 §4, J18).
    AW_FAKE_HOSTING_TOKEN: E2E_HOSTING.token,
    AW_FAKE_HOSTING_REPO: E2E_HOSTING.repo,
    // Deterministic environment checks: a fake `opencode --version` first on PATH (`opencode.cmd` on Windows),
    // no ~/.opencode.
    [pathKey]: `${resolve('e2e/fixtures/bin')}${delimiter}${process.env[pathKey] ?? ''}`,
    HOME: home,
    USERPROFILE: home,
  };

  // The renderer is built (a development bundle, NODE_ENV above, so dev-only pages exist) and served by the backend
  // as in the packaged app. No Vite dev server: when its socket dropped, its client reloaded the page mid-load
  // (CI traces of J9), and its per-request transforms made every page load slow on Windows.
  execSync(`pnpm --filter @aw/web exec vite build --outDir "${webDir}" --emptyOutDir`, {
    env,
    stdio: ['ignore', stdout, 'inherit'],
  });
  const backend = fork('packages/server/src/main.ts', {
    env,
    execArgv: [],
    stdio: ['ignore', stdout, 'inherit', 'ipc'],
  });
  const port = await new Promise<number>((done, fail) => {
    backend.once('exit', (code) => fail(new Error(`E2E backend exited before it was ready (code ${code})`)));
    backend.on('message', (message: { type: string; port: number }) => {
      if (message.type === 'ready') done(message.port);
    });
  });
  process.env[DEV_PORT_ENV.api] = String(port);

  return async () => {
    // The backend shuts down when its channel closes (stopping opencode first, D73) and is awaited.
    const exited = once(backend, 'exit');
    backend.disconnect();
    await exited;
    rmSync(temp.dir, { recursive: true });
  };
}
