import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { DEV_API_PORT, DEV_WEB_PORT } from '@aw/shared';
import { defineConfig } from '@playwright/test';
import { E2E_TOKEN } from './e2e/env.ts';

// One backend serves every browser spec, so specs run one at a time against its state.
const backendHome = mkdtempSync(join(tmpdir(), 'aw-e2e-home-'));
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
      use: { baseURL: `http://localhost:${DEV_WEB_PORT}`, trace: 'retain-on-failure' },
    },
    // Requires `pnpm build` first; launches the built Electron app.
    { name: 'electron', testMatch: /.*\.electron\.spec\.ts/ },
  ],
  webServer: [
    {
      command: 'node packages/server/src/main.ts',
      port: DEV_API_PORT,
      reuseExistingServer: false,
      // In CI the backend's warnings and errors go to the job log, next to a failing spec.
      stdout: process.env.CI === undefined ? 'ignore' : 'pipe',
      stderr: 'pipe',
      env: {
        AW_API_TOKEN: E2E_TOKEN,
        AW_DATA_DIR: join(backendHome, 'data'),
        AW_PORT: String(DEV_API_PORT),
        AW_LOG_LEVEL: 'warn',
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
    {
      command: 'pnpm --filter @aw/web dev',
      url: `http://localhost:${DEV_WEB_PORT}`,
      reuseExistingServer: false,
      // Vite reports dependency re-optimization and full page reloads here.
      stdout: process.env.CI === undefined ? 'ignore' : 'pipe',
      env: { VITE_AW_API_TOKEN: E2E_TOKEN },
    },
  ],
});
