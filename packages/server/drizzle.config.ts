import { defineConfig } from 'drizzle-kit';

// `pnpm --filter @aw/server db:generate` writes a new migration; merged migrations are never edited (10 §1).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/modules/*/*.table.ts',
  out: './migrations',
});
