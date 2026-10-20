import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEV_API_PORT } from '@aw/shared';
import { defineConfig } from '@playwright/test';
import { E2E_TOKEN } from './e2e/env.ts';

// Performance measurements (M6-02, `pnpm perf`): the production build of the renderer, served by a development
// backend whose AI sessions FakeOpencode plays, so the numbers reflect what ships while the data stays scripted.
// Workers load this file again and inherit the runner's environment: the directory is chosen once.
process.env.AW_PERF_HOME ??= mkdtempSync(join(tmpdir(), 'aw-perf-home-'));
const home = process.env.AW_PERF_HOME;
const webDir = join(home, 'web');
process.env.AW_PERF_DATA_DIR = join(home, 'data');

export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.perf\.spec\.ts/,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${DEV_API_PORT}`, viewport: { width: 1280, height: 800 } },
  webServer: {
    // The backend runs in development mode (FakeOpencode), so the renderer build is told it is production.
    command: `NODE_ENV=production pnpm --filter @aw/web exec vite build --outDir ${webDir} --emptyOutDir && node packages/server/src/main.ts`,
    url: `http://127.0.0.1:${DEV_API_PORT}/api/v1/system/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      VITE_AW_API_TOKEN: E2E_TOKEN,
      AW_API_TOKEN: E2E_TOKEN,
      AW_DATA_DIR: process.env.AW_PERF_DATA_DIR,
      AW_WEB_DIR: webDir,
      AW_PORT: String(DEV_API_PORT),
      AW_LOG_LEVEL: 'warn',
      NODE_ENV: 'development',
      AW_FAKE_OPENCODE: '1',
      PATH: `${resolve('e2e/fixtures/bin')}:${process.env.PATH ?? ''}`,
      HOME: home,
    },
  },
});
