import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { loadBuiltinRoles, loadBuiltinWorkflows, loadPrompts } from '@aw/builtin';
import {
  DB_QUERY_TIMEOUT_MS,
  isTerminalState,
  MCP_ASSISTANT_PATH,
  MCP_EXEC_PATH,
  TASK_STATUSES,
  taskMachine,
} from '@aw/shared';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyBaseLogger, type FastifyInstance, LogController } from 'fastify';
import type { DestinationStream } from 'pino';
import { type Clock, systemClock } from './core/clock.ts';
import type { AppConfig } from './core/config.ts';
import { openDatabase } from './core/db/database.ts';
import { createUnitOfWork } from './core/db/unit-of-work.ts';
import { createEventBus, type EventBus } from './core/event-bus.ts';
import { registerTokenAuth } from './core/http/auth.ts';
import { registerErrorHandling } from './core/http/errors.ts';
import { createLogger, type Logger } from './core/logger.ts';
import { mountOperations, type OperationImpl } from './core/operations/operations.ts';
import { registerSseHub } from './core/sse/sse-hub.ts';
import { createAcceptanceModule } from './modules/acceptance/index.ts';
import { type AssistantService, createAssistantModule } from './modules/assistant/index.ts';
import { type AttachmentsService, createAttachmentsModule } from './modules/attachments/index.ts';
import { type AttemptsService, createAttemptsModule } from './modules/attempts/index.ts';
import { createBatchesModule } from './modules/batches/index.ts';
import {
  type BrowserHost,
  type BrowserService,
  createBrowserModule,
  unavailableBrowserHost,
} from './modules/browser/index.ts';
import {
  type CredentialCipher,
  type CredentialsService,
  createCredentialsModule,
  unavailableCipher,
} from './modules/credentials/index.ts';
import { createDatabasesModule, DB_DRIVERS } from './modules/databases/index.ts';
import { createDebugModule } from './modules/debug/index.ts';
import { createDecksModule, type DecksService } from './modules/decks/index.ts';
import { createDeliveryModule } from './modules/delivery/index.ts';
import { createRepoLocks, locateOpencodeShell } from './modules/git/index.ts';
import { createGitReviewsModule } from './modules/git-reviews/index.ts';
import { type HostingEndpoints, PUBLIC_HOSTING } from './modules/hosting/index.ts';
import { createInboxModule, type InboxService } from './modules/inbox/index.ts';
import { createInsightsModule } from './modules/insights/index.ts';
import { createKnowledgeModule, type KnowledgeService } from './modules/knowledge/index.ts';
import { createMcpModule } from './modules/mcp/index.ts';
import { createNodesModule, type NodesService } from './modules/nodes/index.ts';
import {
  buildOpencodeConfig,
  createOpencodeRuntime,
  createRuntimeClient,
  type OpencodeClient,
  type OpencodeRuntime,
} from './modules/opencode/index.ts';
import { createPlansModule } from './modules/plans/index.ts';
import { createPreviewsModule, type PreviewsService } from './modules/previews/index.ts';
import { createProjectsModule } from './modules/projects/index.ts';
import { createRepositoryModule } from './modules/repository/index.ts';
import { createRolesModule, type RolesService } from './modules/roles/index.ts';
import { createScheduler } from './modules/scheduler/index.ts';
import { createSchedulesModule, type SchedulesService } from './modules/schedules/index.ts';
import { createSettingsModule } from './modules/settings/index.ts';
import { createSystemModule } from './modules/system/index.ts';
import { createTasksModule, type TasksService } from './modules/tasks/index.ts';
import { createWorkflowsModule, type WorkflowsService } from './modules/workflows/index.ts';
import { createWorktreesModule, type WorktreesService } from './modules/worktrees/index.ts';

/** Collaborators that tests replace; production uses the defaults. */
export type AppDeps = {
  clock?: Clock;
  /** Captures log output instead of writing stdout and the log file. */
  logDestination?: DestinationStream;
  /** Encryption for stored secrets; without one, credential use fails with CREDENTIAL_UNAVAILABLE. */
  cipher?: CredentialCipher;
  /** Environment used to locate git and opencode (PATH, HOME). */
  env?: NodeJS.ProcessEnv;
  /** Replaces the hosted opencode (FakeOpencode in tests and browser E2E); the runtime is then never started. */
  opencode?: OpencodeClient;
  /** GitHub / GitLab API addresses (FakeHosting in tests); the public platforms by default. */
  hosting?: HostingEndpoints;
  /** Time limit of the AI's database queries; tests shorten `DB_QUERY_TIMEOUT_MS`. */
  dbQueryTimeoutMs?: number;
  /** IANA time zone the assistant tells the time in and insights count days in; the system's by default. */
  timeZone?: string;
  /** Where browser tabs live (29 §5.2): Electron main, or a Chromium in development and tests; none otherwise. */
  browserHost?: BrowserHost;
};

export type App = {
  server: FastifyInstance;
  events: EventBus;
  log: Logger;
  services: {
    credentials: CredentialsService;
    runtime: OpencodeRuntime;
    opencode: OpencodeClient;
    attempts: AttemptsService;
    attachments: AttachmentsService;
    roles: RolesService;
    workflows: WorkflowsService;
    tasks: TasksService;
    nodes: NodesService;
    inbox: InboxService;
    worktrees: WorktreesService;
    previews: PreviewsService;
    browser: BrowserService;
    assistant: AssistantService;
    knowledge: KnowledgeService;
    decks: DecksService;
    schedules: SchedulesService & { settled(): Promise<void> };
  };
  /** Bearer token of the execution MCP at `/mcp/exec`. */
  mcpToken: string;
  /** Bearer token of the assistant MCP at `/mcp/assistant` (D25). */
  assistantMcpToken: string;
  /**
   * Called once the API listens: opencode's MCP endpoint needs the port. Starts task scheduling and the hosted
   * opencode unless it is replaced or not hostable.
   */
  start(apiPort: number): Promise<void>;
  close(): Promise<void>;
};

export async function buildApp(config: AppConfig, deps: AppDeps = {}): Promise<App> {
  const clock = deps.clock ?? systemClock;
  const log = createLogger(config, clock, deps.logDestination);
  const database = openDatabase(join(config.dataDir, 'app.db'), config.migrationsDir);
  const events = createEventBus();
  const unit = createUnitOfWork(database.db, events);
  const locks = createRepoLocks();

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
  // Per-launch secrets of the two MCP endpoints, separate from the renderer token and from each other (D25).
  const mcpToken = randomBytes(32).toString('hex');
  const assistantMcpToken = randomBytes(32).toString('hex');
  let apiPort: number | undefined;
  const runtime = createOpencodeRuntime({
    env,
    binaryPath: () => settings.service.get('opencode.binaryPath'),
    configContent: async () => {
      if (apiPort === undefined) throw new Error('opencode started before the API listens');
      const api = `http://127.0.0.1:${apiPort}`;
      const shell = await locateOpencodeShell(env);
      return JSON.stringify(
        buildOpencodeConfig({
          mcpUrl: `${api}${MCP_EXEC_PATH}`,
          mcpToken,
          assistantMcpUrl: `${api}${MCP_ASSISTANT_PATH}`,
          assistantMcpToken,
          pluginFile: config.opencodePluginFile,
          prompts,
          shell,
        }),
      );
    },
    log,
    events,
    clock,
    logDir: join(config.dataDir, 'logs'),
  });
  const opencode = deps.opencode ?? createRuntimeClient(runtime, log);
  // Before the API and database close: opencode's last requests and events still reach a working backend.
  server.addHook('preClose', () => opencode.shutdown());
  // The hosted runtime can start only once the API listens (its MCP endpoint needs the port) and when no fake
  // replaces it; start() decides that, after which a recheck may start a newly hostable runtime too.
  let hosting = false;
  const startHostedRuntime = async () => {
    if (hosting) await runtime.startIfDown();
  };
  const system = createSystemModule({
    config,
    env,
    runtime,
    opencode,
    credentials: credentials.service,
    startRuntime: startHostedRuntime,
  });
  const databases = createDatabasesModule({
    db: database.db,
    clock,
    log,
    credentials: credentials.service,
    drivers: DB_DRIVERS,
    queryTimeoutMs: deps.dbQueryTimeoutMs ?? DB_QUERY_TIMEOUT_MS,
  });
  const projects = createProjectsModule({
    db: database.db,
    clock,
    credentials: credentials.service,
    databases: databases.service,
    hosting: deps.hosting ?? PUBLIC_HOSTING,
  });
  // Built-in roles and workflows of this app version are written on every start (13).
  const roles = createRolesModule({ db: database.db, clock, log });
  roles.service.syncBuiltin(loadBuiltinRoles(config.promptsDir));
  const workflows = createWorkflowsModule({ db: database.db, clock, log, roles: roles.service });
  workflows.service.syncBuiltin(loadBuiltinWorkflows(config.promptsDir));
  const inbox = createInboxModule({ db: database.db, unit, clock, log });
  const attempts = createAttemptsModule({
    db: database.db,
    unit,
    events,
    clock,
    log,
    opencode,
    inbox: inbox.service,
    settings: settings.service,
    projects: projects.service,
    prompts,
    dataDir: config.dataDir,
  });
  const worktrees = createWorktreesModule({
    db: database.db,
    clock,
    log,
    locks,
    settings: settings.service,
    dataDir: config.dataDir,
  });
  const previews = createPreviewsModule({
    clock,
    log,
    events,
    env,
    settings: settings.service,
    projects: projects.service,
    worktrees: worktrees.service,
    dataDir: config.dataDir,
  });
  const attachments = createAttachmentsModule({
    db: database.db,
    unit,
    clock,
    log,
    projects: projects.service,
    worktrees: worktrees.service,
    dataDir: config.dataDir,
  });
  server.addHook('preClose', async () => {
    attachments.service.stopCleanup();
    await attachments.service.settled();
  });
  // Dev servers end with the backend: nothing else stops them once it is gone.
  server.addHook('preClose', () => previews.service.stopAll());
  const browser = createBrowserModule({
    host: deps.browserHost ?? unavailableBrowserHost,
    clock,
    log,
    events,
    settings: settings.service,
    projects: projects.service,
    previews: previews.service,
  });
  // Before the previews stop: a tab holds a preview's lease.
  server.addHook('preClose', () => browser.service.closeAll());
  const plans = createPlansModule({ db: database.db, unit, clock, log });
  const deliveries = createDeliveryModule({ db: database.db, unit, clock, log });
  const acceptance = createAcceptanceModule({
    attempts: attempts.service,
    roles: roles.service,
    settings: settings.service,
    prompts,
    log,
    clock,
    env,
  });
  const nodes = createNodesModule({
    db: database.db,
    unit,
    clock,
    log,
    attempts: attempts.service,
    acceptance: acceptance.service,
    inbox: inbox.service,
    roles: roles.service,
    settings: settings.service,
    prompts,
    locks,
  });
  const knowledge = createKnowledgeModule({
    db: database.db,
    unit,
    clock,
    attempts: attempts.service,
    projects: projects.service,
    databases: databases.service,
    inbox: inbox.service,
    settings: settings.service,
    prompts,
  });
  const gitReviews = createGitReviewsModule({
    db: database.db,
    unit,
    clock,
    log,
    attempts: attempts.service,
    projects: projects.service,
    roles: roles.service,
    settings: settings.service,
    prompts,
  });
  const tasks = createTasksModule({
    db: database.db,
    unit,
    events,
    clock,
    log,
    settings: settings.service,
    prompts,
    projects: projects.service,
    workflows: workflows.service,
    roles: roles.service,
    worktrees: worktrees.service,
    plans: plans.service,
    nodes: nodes.service,
    attempts: attempts.service,
    inbox: inbox.service,
    deliveries: deliveries.service,
    databases: databases.service,
    knowledge: knowledge.service,
    gitReviews: gitReviews.service,
    locks,
    dataDir: config.dataDir,
  });
  const batches = createBatchesModule({
    db: database.db,
    unit,
    clock,
    log,
    settings: settings.service,
    workflows: workflows.service,
    tasks: tasks.service,
  });
  const decks = createDecksModule({
    db: database.db,
    unit,
    clock,
    attempts: attempts.service,
    projects: projects.service,
    tasks: tasks.service,
    knowledge: knowledge.service,
    inbox: inbox.service,
    settings: settings.service,
    prompts,
    dataDir: config.dataDir,
  });
  const scheduler = createScheduler({
    tasks: tasks.service,
    nodes: nodes.service,
    attempts: attempts.service,
    settings: settings.service,
    events,
    log,
  });
  const timeZone = deps.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const schedules = createSchedulesModule({
    db: database.db,
    unit,
    events,
    clock,
    log,
    timeZone,
    workflows: workflows.service,
    tasks: tasks.service,
    inbox: inbox.service,
  });
  // Stopped before the database closes: a check must not run against a closed database.
  server.addHook('preClose', async () => {
    schedules.timer.stop();
    await schedules.timer.settled();
  });
  const insights = createInsightsModule({ db: database.db, clock, timeZone, tasks: tasks.service });
  const repository = createRepositoryModule({
    projects: projects.service,
    tasks: tasks.service,
    worktrees: worktrees.service,
    locks,
    log,
  });
  const debug = createDebugModule({ attempts: attempts.service, settings: settings.service, prompts });
  const mcp = createMcpModule({
    token: mcpToken,
    attempts: attempts.service,
    tasks: tasks.service,
    acceptance: acceptance.service,
    debug: debug.service,
    knowledge: knowledge.service,
    decks: decks.service,
    gitReviews: gitReviews.service,
    commitDrafts: gitReviews.drafts,
    browser: browser.service,
    filesDirOf: attempts.filesDirOf,
    log,
  });
  mcp.register(server);
  attempts.registerRoutes(server);
  attachments.registerRoutes(server);
  const operations: OperationImpl[] = [
    ...settings.operations,
    ...system.operations,
    ...projects.operations,
    ...attachments.operations,
    ...previews.operations,
    ...browser.operations,
    ...databases.operations,
    ...roles.operations,
    ...workflows.operations,
    ...tasks.operations,
    ...batches.operations,
    ...schedules.operations,
    ...knowledge.operations,
    ...decks.operations,
    ...insights.operations,
    ...plans.operations,
    ...inbox.operations,
    ...attempts.operations,
    ...repository.operations,
    ...gitReviews.operations,
    ...mcp.operations,
    // The debug entry exists in development builds only (M2-09).
    ...(config.nodeEnv === 'production' ? [] : debug.operations),
  ];
  const activeTaskStatuses = TASK_STATUSES.filter((s) => !isTerminalState(taskMachine, s));
  const assistant = createAssistantModule({
    db: database.db,
    events,
    clock,
    log,
    opencode,
    settings: settings.service,
    prompts,
    tasks: tasks.service,
    projects: projects.service,
    workflows: workflows.service,
    knowledge: knowledge.service,
    decks: decks.service,
    batches: batches.service,
    schedules: schedules.service,
    dataDir: config.dataDir,
    timeZone,
    token: assistantMcpToken,
    operations,
    appStatus: async () => ({
      runtime: (await runtime.snapshot()).status,
      uiMode: settings.service.get('ui.mode'),
      projects: projects.service.list().length,
      activeTasks: tasks.service.listByStatus(activeTaskStatuses).length,
      blockingInbox: inbox.service.countBlocking(),
    }),
  });
  assistant.register(server);
  mountOperations(server, [...operations, ...assistant.operations]);

  // Recovery from the previous run (03 §2.1): attempts first (their nodes and tasks react to the interruption), then
  // what is left of nodes and tasks. Scheduling starts once the API listens (start()).
  attempts.service.recover();
  nodes.service.recover();
  tasks.service.recover();

  if (config.webDir !== undefined) await server.register(fastifyStatic, { root: config.webDir });
  return {
    server,
    events,
    log,
    services: {
      credentials: credentials.service,
      runtime,
      opencode,
      attempts: attempts.service,
      attachments: attachments.service,
      roles: roles.service,
      workflows: workflows.service,
      tasks: tasks.service,
      nodes: nodes.service,
      inbox: inbox.service,
      worktrees: worktrees.service,
      previews: previews.service,
      browser: browser.service,
      assistant: assistant.service,
      knowledge: knowledge.service,
      decks: decks.service,
      schedules: { ...schedules.service, settled: schedules.timer.settled },
    },
    mcpToken,
    assistantMcpToken,
    async start(port) {
      apiPort = port;
      hosting = deps.opencode === undefined;
      // Sessions can only call back once the API listens; the scheduler waits for the runtime by itself.
      scheduler.start();
      // Schedules missed while the app was closed are due now and run once (22 §4).
      schedules.timer.start();
      await attachments.service.startCleanup();
      await startHostedRuntime();
    },
    close: () => server.close(),
  };
}
