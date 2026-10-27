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
  /** Likewise the packaged builtin prompts and the built opencode bridge plugin. */
  AW_PROMPTS_DIR: z.string().min(1).optional(),
  AW_OPENCODE_PLUGIN_FILE: z.string().min(1).optional(),
  AW_SKILLS_DIR: z.string().min(1).optional(),
  /** And the bundled worker that parses Word and Excel files (39 §5.1). */
  AW_OFFICE_WORKER_FILE: z.string().min(1).optional(),
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
  promptsDir: string;
  /** `agent-workflow-bridge.js`, loaded by opencode as a plugin (12 §3). */
  opencodePluginFile: string;
  /** The app's own skills, given to opencode as `skills.paths` (41, D206). */
  skillsDir: string;
  /** The worker thread entry that parses Word and Excel attachments (39 §5.1). */
  officeWorkerFile: string;
  appVersion: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  nodeEnv: 'development' | 'production' | 'test';
};

/** Locations relative to this source file; valid when running from source (development, tests). */
const SOURCE_MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));
const SOURCE_PROMPTS_DIR = fileURLToPath(new URL('../../../builtin/prompts', import.meta.url));
const SOURCE_SKILLS_DIR = fileURLToPath(new URL('../../../builtin/skills', import.meta.url));
/** Node strips the types of the worker's TypeScript source itself. */
const SOURCE_OFFICE_WORKER_FILE = fileURLToPath(new URL('../modules/office/office.worker.ts', import.meta.url));
/** Built by `pnpm build:plugin`. */
const SOURCE_PLUGIN_FILE = fileURLToPath(
  new URL('../../../opencode-plugin/dist/agent-workflow-bridge.js', import.meta.url),
);

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const e = envSchema.parse(env);
  return {
    apiToken: e.AW_API_TOKEN,
    dataDir: path.resolve(e.AW_DATA_DIR),
    port: e.AW_PORT,
    webDir: e.AW_WEB_DIR === undefined ? undefined : path.resolve(e.AW_WEB_DIR),
    migrationsDir: e.AW_MIGRATIONS_DIR === undefined ? SOURCE_MIGRATIONS_DIR : path.resolve(e.AW_MIGRATIONS_DIR),
    promptsDir: e.AW_PROMPTS_DIR === undefined ? SOURCE_PROMPTS_DIR : path.resolve(e.AW_PROMPTS_DIR),
    opencodePluginFile:
      e.AW_OPENCODE_PLUGIN_FILE === undefined ? SOURCE_PLUGIN_FILE : path.resolve(e.AW_OPENCODE_PLUGIN_FILE),
    skillsDir: e.AW_SKILLS_DIR === undefined ? SOURCE_SKILLS_DIR : path.resolve(e.AW_SKILLS_DIR),
    officeWorkerFile:
      e.AW_OFFICE_WORKER_FILE === undefined ? SOURCE_OFFICE_WORKER_FILE : path.resolve(e.AW_OFFICE_WORKER_FILE),
    appVersion: e.AW_APP_VERSION,
    logLevel: e.AW_LOG_LEVEL,
    nodeEnv: e.NODE_ENV,
  };
}
