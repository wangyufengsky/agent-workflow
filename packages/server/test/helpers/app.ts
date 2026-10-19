import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_PREFIX } from '@aw/shared';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { type App, type AppDeps, buildApp } from '../../src/app.ts';
import { loadConfig } from '../../src/core/config.ts';

export const TEST_TOKEN = 't'.repeat(64);

export type LogLine = { level: number; msg: string; err?: { message: string; stack: string } };

export type TestApp = {
  app: App;
  dataDir: string;
  logs: LogLine[];
  /** Authorised request to `/api/v1<path>`. */
  request(options: Omit<InjectOptions, 'url'> & { url: string }): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
};

/** Backend on a fresh temporary data directory with captured logs (07 §4). */
export async function createTestApp(deps: Omit<AppDeps, 'logDestination'> = {}): Promise<TestApp> {
  const dataDir = await mkdtemp(join(tmpdir(), 'aw-int-'));
  const logs: LogLine[] = [];
  const logDestination = { write: (line: string) => void logs.push(JSON.parse(line)) };
  const config = loadConfig({ AW_API_TOKEN: TEST_TOKEN, AW_DATA_DIR: dataDir, AW_LOG_LEVEL: 'info', NODE_ENV: 'test' });
  const app = await buildApp(config, { ...deps, logDestination });
  return {
    app,
    dataDir,
    logs,
    request: ({ url, headers, ...rest }) =>
      app.server.inject({
        ...rest,
        url: `${API_PREFIX}${url}`,
        headers: { authorization: `Bearer ${TEST_TOKEN}`, ...headers },
      }),
    close: () => app.close(),
  };
}
