import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  AW_API_TOKEN: z.string().min(32),
  AW_DATA_DIR: z.string().min(1),
  AW_PORT: z.coerce.number().int().min(0).max(65535).default(0),
  AW_WEB_DIR: z.string().min(1).optional(),
  AW_APP_VERSION: z.string().default('0.0.0-dev'),
  AW_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type AppConfig = {
  apiToken: string;
  dataDir: string;
  port: number;
  /** Built renderer served by the backend; absent when the Vite dev server serves it. */
  webDir: string | undefined;
  appVersion: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
};

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const e = envSchema.parse(env);
  return {
    apiToken: e.AW_API_TOKEN,
    dataDir: path.resolve(e.AW_DATA_DIR),
    port: e.AW_PORT,
    webDir: e.AW_WEB_DIR === undefined ? undefined : path.resolve(e.AW_WEB_DIR),
    appVersion: e.AW_APP_VERSION,
    logLevel: e.AW_LOG_LEVEL,
  };
}
