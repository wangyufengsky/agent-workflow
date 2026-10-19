import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_PREFIX, type OperationContract } from '@aw/shared';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import type { z } from 'zod';
import { type App, type AppDeps, buildApp } from '../../src/app.ts';
import { loadConfig } from '../../src/core/config.ts';

export const TEST_TOKEN = 't'.repeat(64);

export type LogLine = { level: number; msg: string; err?: { message: string; stack: string } };

/** A response whose JSON body is typed by the operation's output (meaningful only for 2xx). */
export type OpResponse<O> = { status: number; body: O; raw: LightMyRequestResponse };

export type TestApp = {
  app: App;
  dataDir: string;
  logs: LogLine[];
  /** Authorised request to `/api/v1<path>`. */
  request(options: Omit<InjectOptions, 'url'> & { url: string }): Promise<LightMyRequestResponse>;
  /** Calls an operation over HTTP exactly as the renderer would. */
  call<I extends z.ZodObject, O extends z.ZodType>(
    op: OperationContract<I, O>,
    input: z.input<I>,
  ): Promise<OpResponse<z.output<O>>>;
  close(): Promise<void>;
};

/** Splits an input object into path params (`:name`) and the rest, sent as query (GET/DELETE) or body. */
function toRequest(op: OperationContract, input: Record<string, unknown>): InjectOptions {
  const rest = { ...input };
  const path = op.http.path.replace(/:([A-Za-z]+)/g, (_m, name: string) => {
    const value = rest[name];
    delete rest[name];
    return encodeURIComponent(String(value));
  });
  const url = `${API_PREFIX}${path}`;
  if (op.http.method === 'GET' || op.http.method === 'DELETE') {
    const query = new URLSearchParams(Object.entries(rest).map(([k, v]): [string, string] => [k, String(v)]));
    return { method: op.http.method, url: query.size > 0 ? `${url}?${query}` : url };
  }
  return { method: op.http.method, url, payload: rest };
}

/** Backend on a fresh temporary data directory with captured logs (07 §4). */
export async function createTestApp(deps: Omit<AppDeps, 'logDestination'> = {}): Promise<TestApp> {
  const dataDir = await mkdtemp(join(tmpdir(), 'aw-int-'));
  const logs: LogLine[] = [];
  const logDestination = { write: (line: string) => void logs.push(JSON.parse(line)) };
  const config = loadConfig({ AW_API_TOKEN: TEST_TOKEN, AW_DATA_DIR: dataDir, AW_LOG_LEVEL: 'info', NODE_ENV: 'test' });
  const app = await buildApp(config, { ...deps, logDestination });
  const authorization = `Bearer ${TEST_TOKEN}`;
  return {
    app,
    dataDir,
    logs,
    request: ({ url, headers, ...rest }) =>
      app.server.inject({ ...rest, url: `${API_PREFIX}${url}`, headers: { authorization, ...headers } }),
    async call(op, input) {
      const raw = await app.server.inject({ ...toRequest(op, input), headers: { authorization } });
      // 204 responses have an empty body.
      return { status: raw.statusCode, body: JSON.parse(raw.body === '' ? 'null' : raw.body), raw };
    },
    close: () => app.close(),
  };
}
