import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const envSchema = z.object({
  AW_API_TOKEN: z.string().min(32),
  AW_DATA_DIR: z.string().min(1),
  AW_PORT: z.coerce.number().int().min(0).max(65535).default(0),
  AW_WEB_DIR: z.string().min(1).optional(),
  /** The bundled backend (out/main/server.js) is passed the packaged migrations folder by the Electron main process. */
  AW_MIGRATIONS_DIR: z.string().min(1).optional(),
  AW_APP_VERSION: z.string().default('0.0.0-dev'),
  AW_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
});

export type AppConfig = {
  apiToken: string;
  dataDir: string;
  port: number;
  /** Built renderer served by the backend; absent when the Vite dev server serves it. */
  webDir: string | undefined;
  migrationsDir: string;
  appVersion: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  nodeEnv: 'development' | 'production' | 'test';
};

/** packages/server/migrations, relative to this source file; valid when running from source. */
const SOURCE_MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const e = envSchema.parse(env);
  return {
    apiToken: e.AW_API_TOKEN,
    dataDir: path.resolve(e.AW_DATA_DIR),
    port: e.AW_PORT,
    webDir: e.AW_WEB_DIR === undefined ? undefined : path.resolve(e.AW_WEB_DIR),
    migrationsDir: e.AW_MIGRATIONS_DIR === undefined ? SOURCE_MIGRATIONS_DIR : path.resolve(e.AW_MIGRATIONS_DIR),
    appVersion: e.AW_APP_VERSION,
    logLevel: e.AW_LOG_LEVEL,
    nodeEnv: e.NODE_ENV,
  };
}
