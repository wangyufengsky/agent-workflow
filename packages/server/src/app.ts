import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { loadPrompts } from '@aw/builtin';
import { MCP_EXEC_PATH } from '@aw/shared';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyBaseLogger, type FastifyInstance, LogController } from 'fastify';
import type { DestinationStream } from 'pino';
import { type Clock, systemClock } from './core/clock.ts';
import type { AppConfig } from './core/config.ts';
import { openDatabase } from './core/db/database.ts';
import { createEventBus, type EventBus } from './core/event-bus.ts';
import { registerTokenAuth } from './core/http/auth.ts';
import { registerErrorHandling } from './core/http/errors.ts';
import { createLogger, type Logger } from './core/logger.ts';
import { mountOperations } from './core/operations/operations.ts';
import { registerSseHub } from './core/sse/sse-hub.ts';
import {
  type CredentialCipher,
  type CredentialsService,
  createCredentialsModule,
  unavailableCipher,
} from './modules/credentials/index.ts';
import {
  buildOpencodeConfig,
  createOpencodeRuntime,
  createRuntimeClient,
  type OpencodeClient,
  type OpencodeRuntime,
} from './modules/opencode/index.ts';
import { createProjectsModule } from './modules/projects/index.ts';
import { createSettingsModule } from './modules/settings/index.ts';
import { createSystemModule } from './modules/system/index.ts';

/** Collaborators that tests replace; production uses the defaults. */
export type AppDeps = {
  clock?: Clock;
  /** Captures log output instead of writing stdout and the log file. */
  logDestination?: DestinationStream;
  /** Encryption for stored secrets; without one, credential use fails with CREDENTIAL_UNAVAILABLE. */
  cipher?: CredentialCipher;
  /** Environment used to locate git and opencode (PATH, HOME). */
  env?: NodeJS.ProcessEnv;
};

export type App = {
  server: FastifyInstance;
  events: EventBus;
  log: Logger;
  services: { credentials: CredentialsService; runtime: OpencodeRuntime; opencode: OpencodeClient };
  /** Starts the hosted opencode once the API listens (its MCP endpoint needs the port); no-op if not hostable. */
  startRuntime(apiPort: number): Promise<void>;
  close(): Promise<void>;
};

export async function buildApp(config: AppConfig, deps: AppDeps = {}): Promise<App> {
  const clock = deps.clock ?? systemClock;
  const log = createLogger(config, clock, deps.logDestination);
  const database = openDatabase(join(config.dataDir, 'app.db'), config.migrationsDir);
  const events = createEventBus();

  const fastifyLog: FastifyBaseLogger = log;
  // Per-request lines would drown the state-transition log (06 §10); errors are logged by the error handler.
  const server = Fastify({
    loggerInstance: fastifyLog,
    logController: new LogController({ disableRequestLogging: true }),
  });
  server.addHook('onClose', async () => database.close());
  registerTokenAuth(server, config.apiToken);
  registerErrorHandling(server, { serveSpa: config.webDir !== undefined });
  registerSseHub(server, events);

  const settings = createSettingsModule({ db: database.db, events, clock });
  const credentials = createCredentialsModule({ db: database.db, clock, cipher: deps.cipher ?? unavailableCipher });
  const env = deps.env ?? process.env;
  const prompts = loadPrompts(config.promptsDir);
  // Per-launch secret of the execution MCP, separate from the renderer token (D25).
  const mcpToken = randomBytes(32).toString('hex');
  let apiPort: number | undefined;
  const runtime = createOpencodeRuntime({
    env,
    binaryPath: () => settings.service.get('opencode.binaryPath'),
    configContent: () => {
      if (apiPort === undefined) throw new Error('opencode started before the API listens');
      const mcpUrl = `http://127.0.0.1:${apiPort}${MCP_EXEC_PATH}`;
      return JSON.stringify(buildOpencodeConfig({ mcpUrl, mcpToken, pluginFile: config.opencodePluginFile, prompts }));
    },
    log,
    events,
    clock,
    logDir: join(config.dataDir, 'logs'),
  });
  server.addHook('onClose', () => runtime.stop());
  const opencode = createRuntimeClient(runtime, log);
  const system = createSystemModule({ config, env, runtime, opencode });
  const projects = createProjectsModule({ db: database.db, clock });
  mountOperations(server, [...settings.operations, ...system.operations, ...projects.operations]);

  if (config.webDir !== undefined) await server.register(fastifyStatic, { root: config.webDir });
  return {
    server,
    events,
    log,
    services: { credentials: credentials.service, runtime, opencode },
    async startRuntime(port) {
      apiPort = port;
      await runtime.startIfStopped();
    },
    close: () => server.close(),
  };
}
