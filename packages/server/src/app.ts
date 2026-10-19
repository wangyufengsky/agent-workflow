import { join } from 'node:path';
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
import { createSettingsModule } from './modules/settings/index.ts';
import { registerSystemRoutes } from './modules/system/system.routes.ts';

/** Collaborators that tests replace; production uses the defaults. */
export type AppDeps = {
  clock?: Clock;
  /** Captures log output instead of writing stdout and the log file. */
  logDestination?: DestinationStream;
  /** Encryption for stored secrets; without one, credential use fails with CREDENTIAL_UNAVAILABLE. */
  cipher?: CredentialCipher;
};

export type App = {
  server: FastifyInstance;
  events: EventBus;
  log: Logger;
  services: { credentials: CredentialsService };
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
  registerSystemRoutes(server, config);

  const settings = createSettingsModule({ db: database.db, events, clock });
  const credentials = createCredentialsModule({ db: database.db, clock, cipher: deps.cipher ?? unavailableCipher });
  mountOperations(server, [...settings.operations]);

  if (config.webDir !== undefined) await server.register(fastifyStatic, { root: config.webDir });
  return { server, events, log, services: { credentials: credentials.service }, close: () => server.close() };
}
