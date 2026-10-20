import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_PREFIX, MCP_EXEC_PATH, type OperationContract, toOperationRequest } from '@aw/shared';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import type { z } from 'zod';
import { type App, type AppDeps, buildApp } from '../../src/app.ts';
import { loadConfig } from '../../src/core/config.ts';
import { createFakeOpencode, type FakeOpencode } from '../fakes/fake-opencode.ts';

export const TEST_TOKEN = 't'.repeat(64);

export type LogLine = { level: number; msg: string; err?: { message: string; stack: string } };

/** A response whose JSON body is typed by the operation's output (meaningful only for 2xx). */
export type OpResponse<O> = { status: number; body: O; raw: LightMyRequestResponse };

export type TestApp = {
  app: App;
  dataDir: string;
  logs: LogLine[];
  /** The listening API port (random). */
  port: number;
  /** `http://127.0.0.1:<port>/mcp/exec` */
  mcpUrl: string;
  /** Plays the AI sessions, unless the test runs against the real opencode. */
  fake: FakeOpencode;
  /** Authorised request to `/api/v1<path>`. */
  request(options: Omit<InjectOptions, 'url'> & { url: string }): Promise<LightMyRequestResponse>;
  /** Calls an operation over HTTP exactly as the renderer would. */
  call<I extends z.ZodObject, O extends z.ZodType>(
    op: OperationContract<I, O>,
    input: z.input<I>,
  ): Promise<OpResponse<z.output<O>>>;
  close(): Promise<void>;
};

export type TestAppOptions = Omit<AppDeps, 'logDestination' | 'opencode'> & {
  /** `@opencode` tests: use the hosted runtime (start it with `app.start(port)`) instead of FakeOpencode. */
  realOpencode?: boolean;
  /** Reuse a data directory, e.g. to start the backend again after a simulated exit. */
  dataDir?: string;
  /** Reuse a FakeOpencode, whose sessions outlive a simulated backend restart like opencode's do. */
  fake?: FakeOpencode;
  /** Extra routes for tests of the HTTP layer itself; Fastify only accepts routes before it listens. */
  routes?: (server: FastifyInstance) => void;
};

/**
 * Backend on a fresh temporary data directory with captured logs, listening on a random port so that FakeOpencode
 * (and opencode itself) can reach its MCP endpoint (07 §4).
 */
export async function createTestApp({
  realOpencode = false,
  routes,
  dataDir: reusedDataDir,
  fake: reusedFake,
  ...deps
}: TestAppOptions = {}): Promise<TestApp> {
  const dataDir = reusedDataDir ?? (await mkdtemp(join(tmpdir(), 'aw-int-')));
  const logs: LogLine[] = [];
  const logDestination = { write: (line: string) => void logs.push(JSON.parse(line)) };
  const config = loadConfig({ AW_API_TOKEN: TEST_TOKEN, AW_DATA_DIR: dataDir, AW_LOG_LEVEL: 'info', NODE_ENV: 'test' });
  const fake = reusedFake ?? createFakeOpencode();
  const app = await buildApp(config, { ...deps, logDestination, ...(realOpencode ? {} : { opencode: fake }) });
  routes?.(app.server);
  await app.server.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.server.address();
  if (address === null || typeof address === 'string') throw new Error('Test app is not listening on a TCP port');
  const mcpUrl = `http://127.0.0.1:${address.port}${MCP_EXEC_PATH}`;
  fake.connectMcp({ url: mcpUrl, token: app.mcpToken });
  // With the real runtime the test decides when it starts.
  if (!realOpencode) await app.start(address.port);
  const authorization = `Bearer ${TEST_TOKEN}`;
  return {
    app,
    dataDir,
    logs,
    port: address.port,
    mcpUrl,
    fake,
    request: ({ url, headers, ...rest }) =>
      app.server.inject({ ...rest, url: `${API_PREFIX}${url}`, headers: { authorization, ...headers } }),
    async call(op, input) {
      const { method, url, body } = toOperationRequest(op, input);
      const raw = await app.server.inject({
        method,
        url,
        headers: { authorization },
        ...(body === undefined ? {} : { payload: body }),
      });
      // 204 responses have an empty body.
      return { status: raw.statusCode, body: JSON.parse(raw.body === '' ? 'null' : raw.body), raw };
    },
    async close() {
      await fake.close();
      await app.close();
    },
  };
}
