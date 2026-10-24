import { defineConfig } from 'vitest/config';

// Test layers from docs/07-testing-standards.md §2.
const SOURCES = '{apps,packages}/**';
const IGNORE = ['**/node_modules/**', '**/out/**', '**/dist/**'];
// Each test file's temporary directories are removed after it, and the run's after the run (07 §7).
const TEMP_ROOT = 'packages/server/test/setup/temp-root.ts';
const TEMP_DIR = 'packages/server/test/setup/temp-dir.ts';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          globalSetup: [TEMP_ROOT],
          include: [`${SOURCES}/*.test.{ts,tsx}`],
          exclude: [...IGNORE, '**/*.int.test.ts', '**/*.oc.test.ts'],
          setupFiles: [TEMP_DIR],
        },
      },
      {
        test: {
          name: 'int',
          globalSetup: [TEMP_ROOT],
          include: [`${SOURCES}/*.int.test.ts`],
          exclude: IGNORE,
          // Real git and processes: a git-heavy test takes 1–2 s here, several times that on a busy CI runner and on
          // Windows, where process creation is slow (17 §4.1).
          testTimeout: 30_000,
          setupFiles: [TEMP_DIR, 'packages/server/test/setup/git-config.ts'],
        },
      },
      {
        test: {
          name: 'oc',
          globalSetup: [TEMP_ROOT],
          include: [`${SOURCES}/*.oc.test.ts`],
          exclude: IGNORE,
          testTimeout: 120_000,
          // Hooks start opencode, which the runtime allows OPENCODE_START_TIMEOUT_MS (30 s) to come up.
          hookTimeout: 60_000,
          // Files one after another: each hosts its own opencode on the user's opencode database, and processes
          // starting together fail with "database is locked".
          fileParallelism: false,
          setupFiles: [TEMP_DIR],
        },
      },
      {
        // Suites one after another: each hosts its own opencode, and the free model is shared.
        test: {
          name: 'live',
          globalSetup: [TEMP_ROOT],
          include: ['live/**/*.live.test.ts'],
          testTimeout: 1_800_000,
          fileParallelism: false,
          setupFiles: [TEMP_DIR],
        },
      },
    ],
  },
});
