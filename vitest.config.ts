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
      { test: { name: 'oc', include: [`${SOURCES}/*.oc.test.ts`], exclude: IGNORE, testTimeout: 120_000 } },
      { test: { name: 'live', include: ['live/**/*.live.test.ts'], testTimeout: 1_800_000 } },
    ],
  },
});
