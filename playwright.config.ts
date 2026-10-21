import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { DEV_API_PORT } from '@aw/shared';
import { defineConfig } from '@playwright/test';
import { E2E_TOKEN } from './e2e/env.ts';

// One backend serves every browser spec, so specs run one at a time against its state.
const backendHome = mkdtempSync(join(tmpdir(), 'aw-e2e-home-'));
const webDir = join(backendHome, 'web');
// Windows spells it `Path`; a second, differently cased key would be ambiguous for the backend.
const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  projects: [
    {
      name: 'browser',
      testMatch: /.*\.browser\.spec\.ts/,
      // A failure keeps its trace (network, console, DOM snapshots): an intermittent one must be diagnosable (07 §1).
      use: { baseURL: `http://127.0.0.1:${DEV_API_PORT}`, trace: 'retain-on-failure' },
    },
    // Requires `pnpm build` first; launches the built Electron app.
    { name: 'electron', testMatch: /.*\.electron\.spec\.ts/ },
  ],
  webServer: [
    {
      // The renderer is built (a development bundle, NODE_ENV below, so dev-only pages exist) and served by the backend
      // as in the packaged app. No Vite dev server: when its socket dropped, its client reloaded the page mid-load
      // (CI traces of J9), and its per-request transforms made every page load slow on Windows.
      command: `pnpm --filter @aw/web exec vite build --outDir "${webDir}" --emptyOutDir && node packages/server/src/main.ts`,
      url: `http://127.0.0.1:${DEV_API_PORT}/api/v1/system/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      // In CI the backend's log goes to the job log, next to a failing spec.
      stdout: process.env.CI === undefined ? 'ignore' : 'pipe',
      stderr: 'pipe',
      env: {
        VITE_AW_API_TOKEN: E2E_TOKEN,
        AW_WEB_DIR: webDir,
        AW_API_TOKEN: E2E_TOKEN,
        AW_DATA_DIR: join(backendHome, 'data'),
        AW_PORT: String(DEV_API_PORT),
        // In CI the state transitions with their timestamps show where a slow platform spends its time (17 §4.1).
        AW_LOG_LEVEL: process.env.CI === undefined ? 'warn' : 'info',
        NODE_ENV: 'development',
        // AI sessions are played by FakeOpencode (07 §2), which also reports a model so the environment is ready.
        AW_FAKE_OPENCODE: '1',
        // Deterministic environment checks: a fake `opencode --version` first on PATH (`opencode.cmd` on Windows),
        // no ~/.opencode.
        [pathKey]: `${resolve('e2e/fixtures/bin')}${delimiter}${process.env[pathKey] ?? ''}`,
        HOME: backendHome,
        USERPROFILE: backendHome,
      },
    },
  ],
});
