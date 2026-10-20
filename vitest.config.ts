import { defineConfig } from 'vitest/config';

// Test layers from docs/07-testing-standards.md §2.
const SOURCES = '{apps,packages}/**';
const IGNORE = ['**/node_modules/**', '**/out/**', '**/dist/**'];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: [`${SOURCES}/*.test.{ts,tsx}`],
          exclude: [...IGNORE, '**/*.int.test.ts', '**/*.oc.test.ts'],
        },
      },
      { test: { name: 'int', include: [`${SOURCES}/*.int.test.ts`], exclude: IGNORE } },
      {
        test: {
          name: 'oc',
          include: [`${SOURCES}/*.oc.test.ts`],
          exclude: IGNORE,
          testTimeout: 120_000,
          // Hooks start opencode, which the runtime allows OPENCODE_START_TIMEOUT_MS (30 s) to come up.
          hookTimeout: 60_000,
        },
      },
      {
        // Suites one after another: each hosts its own opencode, and the free model is shared.
        test: { name: 'live', include: ['live/**/*.live.test.ts'], testTimeout: 1_800_000, fileParallelism: false },
      },
    ],
  },
});
