import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEV_API_PORT, DEV_WEB_PORT } from '@aw/shared';
import { defineConfig } from '@playwright/test';

const E2E_TOKEN = 'e2e'.padEnd(64, '0');

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: true,
  retries: 0,
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
        AW_DATA_DIR: join(tmpdir(), `aw-e2e-${process.pid}`),
        AW_PORT: String(DEV_API_PORT),
        AW_LOG_LEVEL: 'warn',
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
