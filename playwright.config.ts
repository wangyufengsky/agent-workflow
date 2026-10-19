import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEV_API_PORT, DEV_WEB_PORT } from '@aw/shared';
import { defineConfig } from '@playwright/test';
import { E2E_TOKEN } from './e2e/env.ts';

// One backend serves every browser spec, so specs run one at a time against its state.
const backendHome = mkdtempSync(join(tmpdir(), 'aw-e2e-home-'));

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  projects: [
    { name: 'browser', testMatch: /.*\.browser\.spec\.ts/, use: { baseURL: `http://localhost:${DEV_WEB_PORT}` } },
    // Requires `pnpm build` first; launches the built Electron app.
    { name: 'electron', testMatch: /.*\.electron\.spec\.ts/ },
  ],
  webServer: [
    {
      command: 'node packages/server/src/main.ts',
      port: DEV_API_PORT,
      reuseExistingServer: false,
      env: {
        AW_API_TOKEN: E2E_TOKEN,
        AW_DATA_DIR: join(backendHome, 'data'),
        AW_PORT: String(DEV_API_PORT),
        AW_LOG_LEVEL: 'warn',
        NODE_ENV: 'development',
        // Deterministic environment checks: a fake `opencode --version` first on PATH, no ~/.opencode.
        PATH: `${resolve('e2e/fixtures/bin')}:${process.env.PATH ?? ''}`,
        HOME: backendHome,
      },
    },
    {
      command: 'pnpm --filter @aw/web dev',
      url: `http://localhost:${DEV_WEB_PORT}`,
      reuseExistingServer: false,
      env: { VITE_AW_API_TOKEN: E2E_TOKEN },
    },
  ],
});
