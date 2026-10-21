import { devPorts } from '@aw/shared';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  // Starts the backend the browser specs share, on a port it reports (D77); workers load this file again after it.
  globalSetup: './e2e/global-setup.ts',
  projects: [
    {
      name: 'browser',
      testMatch: /.*\.browser\.spec\.ts/,
      // A failure keeps its trace (network, console, DOM snapshots): an intermittent one must be diagnosable (07 §1).
      use: { baseURL: `http://127.0.0.1:${devPorts(process.env).api}`, trace: 'retain-on-failure' },
    },
    // Requires `pnpm build` first; launches the built Electron app.
    { name: 'electron', testMatch: /.*\.electron\.spec\.ts/ },
  ],
});
