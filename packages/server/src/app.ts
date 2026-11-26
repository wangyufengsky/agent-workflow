import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import {
  BUILTIN_INITIATIVE_TEMPLATES,
  BuiltinRoleKey,
  loadBuiltinDesignTemplates,
  loadBuiltinRoles,
  loadBuiltinWorkflows,
  loadPrompts,
} from '@aw/builtin';
import {
  AppError,
  DB_QUERY_TIMEOUT_MS,
  ErrorCode,
  getAssistantContextOp,
  getAttemptContextOp,
  isTerminalState,
  MCP_ASSISTANT_PATH,
  MCP_EXEC_PATH,
  McpToolName,
  type ModelEffort,
  modelEfforts,
  OPENCODE_ASSISTANT_AGENT,
  RuntimeStatus,
  ServerEventType,
  TASK_STATUSES,
  taskMachine,
} from '@aw/shared';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyBaseLogger, type FastifyInstance, LogController } from 'fastify';
import type { DestinationStream } from 'pino';
import { type Clock, systemClock } from './core/clock.ts';
import type { AppConfig } from './core/config.ts';
import { DATABASE_FILE, openDatabase } from './core/db/database.ts';
import { createUnitOfWork } from './core/db/unit-of-work.ts';
import { createEventBus, type EventBus } from './core/event-bus.ts';
import { registerTokenAuth } from './core/http/auth.ts';
import { registerErrorHandling } from './core/http/errors.ts';
import { createLogger, type Logger } from './core/logger.ts';
import { implement, mountOperations, type OperationImpl } from './core/operations/operations.ts';
import { host } from './core/platform.ts';
import { registerSseHub } from './core/sse/sse-hub.ts';
import { applyStartupEnvironment, scopedStartupEnvironment } from './core/startup-environment.ts';
import { createAcceptanceModule } from './modules/acceptance/index.ts';
import { type AssistantService, createAssistantModule, createBrowserActivity } from './modules/assistant/index.ts';
import { type AttachmentsService, createAttachmentsModule } from './modules/attachments/index.ts';
import { type AttemptsService, createAttemptsModule } from './modules/attempts/index.ts';
import { createBatchesModule } from './modules/batches/index.ts';
import {
  type BrowserHost,
  type BrowserService,
  createBrowserModule,
  runBrowserCase,
  unavailableBrowserHost,
} from './modules/browser/index.ts';
import {
  type CredentialCipher,
  type CredentialsService,
  createCredentialsModule,
  unavailableCipher,
} from './modules/credentials/index.ts';
import { createDatabaseInvestigations, type DatabaseInvestigations } from './modules/database-investigations/index.ts';
import { createDatabasesModule, DB_DRIVERS, type DbDriver } from './modules/databases/index.ts';
import { createDebugModule } from './modules/debug/index.ts';
import { createDecksModule, type DecksService } from './modules/decks/index.ts';
import { createDeliveryModule } from './modules/delivery/index.ts';
import {
  createDesignsModule,
  createDesignsRepo,
  createReadyDesignKnowledgeReader,
  createReviewKnowledgeReader,
  type DesignsService,
  renderProjectDesignContext,
  syncBuiltinDesignTemplates,
} from './modules/designs/index.ts';
import { createDocumentProcessor } from './modules/document-processor/index.ts';
import { createFunctionalTestsModule, type FunctionalTestsService } from './modules/functional-tests/index.ts';
import { createRepoLocks, locateOpencodeShell } from './modules/git/index.ts';
import { createGitReviewsModule } from './modules/git-reviews/index.ts';
import { createHostingModule, type HostingEndpoints, PUBLIC_HOSTING } from './modules/hosting/index.ts';
import { createImageAnalysis } from './modules/image-analysis/index.ts';
import { createInboxModule, type InboxService } from './modules/inbox/index.ts';
import { createInitiativesModule, type InitiativesService } from './modules/initiatives/index.ts';
import { createInsightsModule } from './modules/insights/index.ts';
import {
  createKnowledgeModule,
  type KnowledgeService,
  readKnowledgePermissionPolicy,
} from './modules/knowledge/index.ts';
import { createMcpModule } from './modules/mcp/index.ts';
import { createModelSlotsModule } from './modules/model-slots/index.ts';
import { createNetworkModule, validateNetworkSettings } from './modules/network/index.ts';
import { createNodesModule, type NodesService } from './modules/nodes/index.ts';
import { createOffice } from './modules/office/index.ts';
import {
  type ContextOwner,
  createBudgetSnapshots,
  createContextInspector,
  createContextSummaries,
  createOpencodeRuntime,
  createRuntimeClient,
  createSessionDispatcher,
  type OpencodeClient,
  OpencodeEventType,
  type OpencodeRuntime,
  opencodeLaunchEnv,
  registerContextRoutes,
  visibleRecallTool,
} from './modules/opencode/index.ts';
import { createPermissionReviewer } from './modules/permissions/index.ts';
import { createPlansModule } from './modules/plans/index.ts';
import { createPreviewsModule, type PreviewsService } from './modules/previews/index.ts';
import { createProjectModules, runIdeaAcceptance } from './modules/project-modules/index.ts';
import { createProjectsModule } from './modules/projects/index.ts';
import { projectRuntimeOperations } from './modules/projects/projects.runtime-operations.ts';
import { createProjectRuntimeService } from './modules/projects/projects.runtime-service.ts';
import { createRepositoryModule } from './modules/repository/index.ts';
import { createRequirementsModule } from './modules/requirements/index.ts';
import { createRolesModule, type RolesService } from './modules/roles/index.ts';
import { createScheduler } from './modules/scheduler/index.ts';
import { createSchedulesModule, type SchedulesService } from './modules/schedules/index.ts';
import { createSettingsModule } from './modules/settings/index.ts';
import { createSkillsModule } from './modules/skills/index.ts';
import { createStartupEnvironmentModule, type StartupEnvironmentService } from './modules/startup-environment/index.ts';
import { createStorageModule } from './modules/storage/index.ts';
import { createSystemModule } from './modules/system/index.ts';
import {
  createTasksModule,
  createTestFollowups,
  findTestRerunOrigin,
  readTaskPermissionPolicy,
  readTaskSkills,
  type TasksService,
} from './modules/tasks/index.ts';
import { createTeamModule } from './modules/team/index.ts';
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
  /** Normal backend entry point updates its own environment for tools which inherit it by default. */
  onStartupEnvironment?: (
    overlay: Readonly<Record<string, string>>,
    deferred: readonly string[],
    runtimeEnv: NodeJS.ProcessEnv,
  ) => void;
  /** Replaces the hosted opencode (FakeOpencode in tests and browser E2E); the runtime is then never started. */
  opencode?: OpencodeClient;
  /** GitHub / GitLab API addresses (FakeHosting in tests); the public platforms by default. */
  hosting?: HostingEndpoints;
  /** Time limit of the AI's database queries; tests shorten `DB_QUERY_TIMEOUT_MS`. */
  dbQueryTimeoutMs?: number;
  dbDrivers?: Readonly<Record<keyof typeof DB_DRIVERS, DbDriver>>;
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
    startupEnvironment: StartupEnvironmentService;
    databaseInvestigations: DatabaseInvestigations;
    runtime: OpencodeRuntime;
    opencode: OpencodeClient;
    attempts: AttemptsService;
    attachments: AttachmentsService;
    roles: RolesService;
    workflows: WorkflowsService;
    tasks: TasksService;
    functionalTests: FunctionalTestsService;
    nodes: NodesService;
    inbox: InboxService;
    worktrees: WorktreesService;
    previews: PreviewsService;
    browser: BrowserService;
    assistant: AssistantService;
    knowledge: KnowledgeService;
    decks: DecksService;
    designs: DesignsService;
    schedules: SchedulesService & { settled(): Promise<void> };
    initiatives: InitiativesService;
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
  const database = openDatabase(join(config.dataDir, DATABASE_FILE), config.migrationsDir);
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

  const settings = createSettingsModule({
    db: database.db,
    events,
    clock,
    validate: validateNetworkSettings,
    validateEffort,
  });
  const credentials = createCredentialsModule({ db: database.db, clock, cipher: deps.cipher ?? unavailableCipher });
  const startupEnvironment = createStartupEnvironmentModule({ db: database.db, credentials: credentials.service });
  const env = scopedStartupEnvironment(deps.env ?? process.env);
  const installOverlay = ({ env: overlay, deferred }: { env: Record<string, string>; deferred: string[] }) => {
    applyStartupEnvironment(env, overlay, deferred);
    deps.onStartupEnvironment?.(overlay, deferred, env);
  };
  const startup = await startupEnvironment.service.resolve();
  installOverlay(startup);
  if (startup.deferred.length > 0) {
    log.info({ count: startup.deferred.length }, 'startup credentials were deferred until unlock');
    credentials.service.onUnlock(async () => {
      try {
        const restored = await startup.retryDeferred();
        installOverlay(restored);
        if (Object.keys(restored.env).some((key) => /^(?:HTTPS?|ALL|NO)_PROXY$/i.test(key)))
          network.refreshProxyEnvironment();
      } catch {
        log.warn('deferred startup credentials could not be resolved after unlock');
      }
    });
  }
  const network = await createNetworkModule({ settings: settings.service, events, env, dataDir: config.dataDir, log });
  server.addHook('onClose', async () => network.close());
  const prompts = loadPrompts(config.promptsDir);
  // Per-launch secrets of the two MCP endpoints, separate from the renderer token and from each other (D25).
  const mcpToken = randomBytes(32).toString('hex');
  const assistantMcpToken = randomBytes(32).toString('hex');
  let apiPort: number | undefined;
  let waitingForHeaderUnlock = false;
  const runtime = createOpencodeRuntime({
    env,
    binaryPath: () => settings.service.get('opencode.binaryPath'),
    launchEnv: async (version) => {
      if (apiPort === undefined) throw new Error('opencode started before the API listens');
      const api = `http://127.0.0.1:${apiPort}`;
      const shell = await locateOpencodeShell(env);
      const offline = settings.service.get('network.offline');
      let headers: Record<string, string>;
      try {
        headers = await startupEnvironment.headers.values();
        waitingForHeaderUnlock = false;
      } catch (error) {
        waitingForHeaderUnlock = error instanceof AppError && error.code === ErrorCode.CredentialLocked;
        throw error;
      }
      const hasHeaders = Object.keys(headers).length > 0;
      const launchEnv = opencodeLaunchEnv({
        runtimeVersion: version,
        readHeaderInput: hasHeaders,
        mcpUrl: `${api}${MCP_EXEC_PATH}`,
        mcpToken,
        assistantMcpUrl: `${api}${MCP_ASSISTANT_PATH}`,
        assistantMcpToken,
        pluginFile: config.opencodePluginFile,
        skillsDir: config.skillsDir,
        prompts,
        shell,
        offline,
      });
      // opencode's grep, glob and skill tools run rg, downloading it when missing: not on intranet machines (D213).
      const ripgrep = config.ripgrepDir === undefined ? {} : host.pathAppending(env, config.ripgrepDir);
      return {
        env: { ...launchEnv, ...ripgrep },
        offline,
        ...(hasHeaders ? { headerInput: JSON.stringify(headers) } : {}),
      };
    },
    networkEnv: network.opencodeEnv,
    log,
    events,
    clock,
    logDir: join(config.dataDir, 'logs'),
  });
  const opencode = deps.opencode ?? createRuntimeClient(runtime, log);
  async function supportsEffort(effort: ModelEffort, selectedModel: () => string | null) {
    const { available, defaultModel } = await opencode.listModels();
    const selected = selectedModel() ?? defaultModel;
    const model = available.find((m) => m.providerId + '/' + m.modelId === selected);
    return (
      selected === effort.model && !!model && (effort.variant === null || !!model.variants?.includes(effort.variant))
    );
  }
  async function validateEffort(effort: ModelEffort, selectedModel: () => string | null) {
    if (!(await supportsEffort(effort, selectedModel))) {
      throw new AppError(ErrorCode.ValidationFailed, 'The selected model does not offer this variant');
    }
  }
  // Before the API and database close: opencode's last requests and events still reach a working backend.
  server.addHook('preClose', async () => {
    // 临时碎碎念会话须在运行时关闭前取消并删除。
    await assistant.stopWhisper();
    assistant.service.dispose();
    await opencode.shutdown();
  });
  // The hosted runtime can start only once the API listens (its MCP endpoint needs the port) and when no fake
  // replaces it; start() decides that, after which a recheck may start a newly hostable runtime too.
  let hosting = false;
  const startHostedRuntime = async () => {
    if (hosting) await runtime.startIfDown();
  };
  credentials.service.onUnlock(async () => {
    if (waitingForHeaderUnlock) await startHostedRuntime();
  });
  const databases = createDatabasesModule({
    db: database.db,
    clock,
    log,
    credentials: credentials.service,
    drivers: deps.dbDrivers ?? DB_DRIVERS,
    queryTimeoutMs: deps.dbQueryTimeoutMs ?? DB_QUERY_TIMEOUT_MS,
  });
  const hostingEndpoints = deps.hosting ?? PUBLIC_HOSTING;
  const hostingAccounts = createHostingModule({
    db: database.db,
    clock,
    credentials: credentials.service,
    endpoints: hostingEndpoints,
  });
  const projects = createProjectsModule({
    db: database.db,
    clock,
    locks,
    credentials: credentials.service,
    databases: databases.service,
    hosting: hostingEndpoints,
    hostingAccounts: hostingAccounts.service,
  });
  const system = createSystemModule({
    config,
    env,
    runtime,
    opencode,
    credentials: credentials.service,
    projects: projects.service,
    startRuntime: startHostedRuntime,
  });
  // Built-in roles and workflows of this app version are written on every start (13).
  const roles = createRolesModule({
    db: database.db,
    clock,
    log,
    validateEffort,
    supportsEffort,
    defaultModel: () => settings.service.get('ai.defaultModel'),
    supportsImage: async (model) =>
      (await opencode.listModels()).available.some((m) => m.supportsImage && model === m.providerId + '/' + m.modelId),
  });
  roles.service.syncBuiltin(loadBuiltinRoles(config.promptsDir));
  const workflows = createWorkflowsModule({ db: database.db, unit, clock, log, roles: roles.service });
  workflows.service.syncBuiltin(loadBuiltinWorkflows(config.promptsDir));
  const designsRepo = createDesignsRepo(database.db);
  syncBuiltinDesignTemplates(designsRepo, unit, clock, loadBuiltinDesignTemplates(config.promptsDir));
  const skills = createSkillsModule({
    db: database.db,
    unit,
    projects: projects.service,
    workflows: workflows.service,
    roles: roles.service,
    skillsDir: config.skillsDir,
  });
  const inbox = createInboxModule({ db: database.db, unit, clock, log });
  const modelSlots = createModelSlotsModule({ settings: settings.service, events, log });
  const sessions = createSessionDispatcher({ opencode, slots: modelSlots.service, clock, log });
  server.addHook('preClose', () => sessions.close());
  const databaseInvestigations = createDatabaseInvestigations({
    db: database.db,
    clock,
    databases: databases.service,
    sessions,
    opencode,
    model: () => {
      const role = roles.service.getByKey(BuiltinRoleKey.DatabaseAnalyst);
      return {
        model: role.model ?? settings.service.get('ai.defaultModel'),
        efforts: modelEfforts(settings.service.getAll(), role),
      };
    },
    dataDir: config.dataDir,
    log,
  });
  databaseInvestigations.recover();
  const unsubscribeDatabaseInvestigations = events.subscribe((event) => {
    if (
      event.type === ServerEventType.TaskDeleted ||
      (event.type === ServerEventType.RuntimeUpdated && event.data.status === RuntimeStatus.Ready)
    ) {
      void databaseInvestigations
        .cleanup()
        .catch((error) => log.warn({ err: error }, 'database investigation cleanup failed'));
    }
  });
  server.addHook('preClose', async () => {
    unsubscribeDatabaseInvestigations();
    await databaseInvestigations.dispose();
  });

  const permissionReviewer = createPermissionReviewer({
    db: database.db,
    sessions,
    settings: settings.service,
    roles: roles.service,
    clock,
    log,
    opencode,
  });
  const imageAnalysis = createImageAnalysis({
    roles: roles.service,
    clock,
    settings: settings.service,
    sessions,
    opencode,
  });
  server.addHook('preClose', async () => modelSlots.service.dispose());
  const attempts = createAttemptsModule({
    permissionReviewer,
    effortsForRole: (id) => modelEfforts(settings.service.getAll(), id ? roles.service.get(id) : undefined),
    taskPolicy: (id) => readTaskPermissionPolicy(database.db, id),
    knowledgePolicy: (id) => readKnowledgePermissionPolicy(database.db, id),
    sessions,
    taskSkills: (id) => readTaskSkills(database.db, id),
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
    slots: modelSlots.service,
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
    isFrontend: (taskId): boolean => tasks.service.isFrontend(taskId),
    clock,
    log,
    events,
    env,
    settings: settings.service,
    projects: projects.service,
    worktrees: worktrees.service,
    dataDir: config.dataDir,
  });
  const office = createOffice({ clock, workerFile: config.officeWorkerFile });
  const attachments = createAttachmentsModule({
    db: database.db,
    unit,
    clock,
    log,
    projects: projects.service,
    worktrees: worktrees.service,
    prompts,
    office,
    dataDir: config.dataDir,
  });
  server.addHook('preClose', async () => {
    attachments.service.stopCleanup();
    await attachments.service.settled();
  });
  const documentProcessor = createDocumentProcessor({
    attachments: attachments.service,
    roles: roles.service,
    sessions,
    settings: settings.service,
    opencode,
  });
  // Dev servers end with the backend: nothing else stops them once it is gone.
  server.addHook('preClose', () => previews.service.stopAll());
  const browser = createBrowserModule({
    activity: createBrowserActivity(database.db, clock, events),
    host: deps.browserHost ?? unavailableBrowserHost,
    clock,
    log,
    events,
    settings: settings.service,
    network: network.browserNetwork,
    projects: projects.service,
    previews: previews.service,
    dataDir: config.dataDir,
    attemptFilesDir: (attemptId) => attempts.filesDirOf(attempts.service.get(attemptId)),
  });
  // Before the previews stop: a tab holds a preview's lease.
  server.addHook('preClose', () => browser.service.closeAll());
  const plans = createPlansModule({ db: database.db, unit, clock, log });
  const deliveries = createDeliveryModule({ db: database.db, unit, clock, log });
  const acceptance = createAcceptanceModule({
    attempts: attempts.service,
    browser: browser.service,
    roles: roles.service,
    settings: settings.service,
    prompts,
    log,
    clock,
    env,
  });
  const projectRuntime = createProjectRuntimeService({
    db: database.db,
    log,
    clock,
    env,
    locks,
    projects: projects.service,
    acceptance: acceptance.service,
    dataDir: config.dataDir,
  });
  server.addHook('onReady', () => projectRuntime.recover());
  server.addHook('preClose', () => projectRuntime.stopAll());
  const projectModules = createProjectModules({
    db: database.db,
    projects: projects.service,
    log,
    clock,
    env,
    locks,
    dataDir: config.dataDir,
  });
  server.addHook('onReady', () => projectModules.recover());
  server.addHook('preClose', () => projectModules.stopAll());
  const readyDesignKnowledge = createReadyDesignKnowledgeReader(designsRepo, attempts.service);
  const projectDesignContext = (projectId: string, targetSha: string | null) =>
    renderProjectDesignContext(readyDesignKnowledge.read(projectId, targetSha), targetSha);
  const nodes = createNodesModule({
    projectDesignContext,
    runIdeaCheck: (ctx, changedPaths, signal) =>
      runIdeaAcceptance({ worktreePath: ctx.directory, repoPath: ctx.repoPath, changedPaths, clock, env, signal }),
    runBrowserCase: (attempt, test, signal) => {
      const owner = {
        id: attempt.id,
        taskId: attempt.taskId,
        projectId: attempts.service.projectOf(attempt.id),
        filesDir: attempts.filesDirOf(attempt),
        browserTest: test.scope,
        savedCase: true,
      };
      return runBrowserCase(browser.service, owner, test, signal, (step, reason) =>
        attempts.service.waitForLocalInput(attempt.id, () =>
          browser.service.caseHandoffs.wait(owner, step, reason, signal),
        ),
      );
    },
    isBrowserTestTask: (id): boolean => tasks.service.browserTest(id) !== null,
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
    attachments: attachments.service,
    projects: projects.service,
    databases: databases.service,
    inbox: inbox.service,
    settings: settings.service,
    prompts,
    browser: browser.service,
  });
  const gitReviews = createGitReviewsModule({
    designs: designsRepo,
    readKnowledge: createReviewKnowledgeReader(designsRepo),
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
  const requirements = createRequirementsModule({ db: database.db, clock });
  const tasks = createTasksModule({
    selectProjectModule: projectModules.select,
    selectProjectCompound: projectModules.selectCompound,
    skills: skills.service,
    office,
    opencode,
    previews: previews.service,
    gitNetwork: network.gitEnv,
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
    browser: browser.service,
    attachments: attachments.service,
    requirements: requirements.service,
    inbox: inbox.service,
    deliveries: deliveries.service,
    databases: databases.service,
    knowledge: knowledge.service,
    gitReviews: gitReviews.service,
    readyDesignKnowledge,
    locks,
    dataDir: config.dataDir,
  });
  const functionalTests = createFunctionalTestsModule({
    env,
    projectDirectory: (id) => projects.service.getRecord(id).repoPath,
    db: database.db,
    rerunOrigin: (taskId) => findTestRerunOrigin(database.db, taskId),
    unit,
    clock,
    events,
    task: tasks.service.detail,
    attempts: attempts.service,
    browser: browser.service,
    previews: previews.service,
    filesDirOf: attempts.filesDirOf,
    log,
  });
  const testFollowups = createTestFollowups({
    db: database.db,
    unit,
    tasks: tasks.service,
    projects: projects.service,
    workflows: workflows.service,
    tests: functionalTests.service,
    events,
    log,
  });
  server.addHook('preClose', () => testFollowups.close());
  server.addHook('preClose', () => functionalTests.service.stopAll());
  worktrees.service.onBeforeRemove((worktree) => functionalTests.service.stop(worktree.taskId));
  tasks.service.onProjectDeleted((id) => {
    projectRuntime.abortProject(id);
    projectModules.abortProject(id);
    queueMicrotask(() => {
      void databaseInvestigations
        .cleanup()
        .catch((error) => log.warn({ err: error }, 'database investigation cleanup failed'));
    });
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
  const initiatives = createInitiativesModule({
    projectDesignContext,
    hasReadyDesign: readyDesignKnowledge.hasReadyDesign,
    db: database.db,
    unit,
    events,
    clock,
    log,
    settings: settings.service,
    workflows: workflows.service,
    tasks: tasks.service,
    attachments: attachments.service,
    attempts: attempts.service,
    projects: projects.service,
    roles: roles.service,
    prompts,
  });
  // Built-in composition templates of this app version, like the built-in workflows (34 §15.3).
  initiatives.service.templates.syncBuiltin(BUILTIN_INITIATIVE_TEMPLATES);
  const scheduler = createScheduler({
    tasks: tasks.service,
    nodes: nodes.service,
    attempts: attempts.service,
    settings: settings.service,
    roles: roles.service,
    slots: modelSlots.service,
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
  const storage = createStorageModule({
    dataDir: config.dataDir,
    clock,
    settings: settings.service,
    tasks: tasks.service,
  });
  const team = createTeamModule({
    db: database.db,
    unit,
    events,
    clock,
    log,
    timeZone,
    projects: projects.service,
    attempts: attempts.service,
    roles: roles.service,
    settings: settings.service,
    prompts,
  });
  const repository = createRepositoryModule({
    projects: projects.service,
    tasks: tasks.service,
    worktrees: worktrees.service,
    locks,
    log,
    gitNetwork: network.gitEnv,
  });
  const debug = createDebugModule({ attempts: attempts.service, settings: settings.service, prompts });
  const designs = createDesignsModule({
    repo: designsRepo,
    attempts: attempts.service,
    projects: projects.service,
    inbox: inbox.service,
    settings: settings.service,
    assetsDir: config.designSiteAssetsDir,
    copyFile: config.designSiteCopyFile,
    unit,
    clock,
    log,
    prompts,
  });
  server.addHook('preClose', async () => designs.service.close());
  const decks = createDecksModule({
    db: database.db,
    unit,
    clock,
    attempts: attempts.service,
    projects: projects.service,
    tasks: tasks.service,
    knowledge: knowledge.service,
    design: designs.service.get,
    gitReview: gitReviews.service.get,
    browser: browser.service,
    inbox: inbox.service,
    settings: settings.service,
    prompts,
    dataDir: config.dataDir,
  });
  const mcp = createMcpModule({
    databaseInvestigations,
    events,
    token: mcpToken,
    functionalTests: functionalTests.service,
    attempts: attempts.service,
    tasks: tasks.service,
    acceptance: acceptance.service,
    debug: debug.service,
    knowledge: knowledge.service,
    decks: decks.service,
    designSubmissions: designs.submissions,
    gitReviews: gitReviews.service,
    commitDrafts: gitReviews.drafts,
    team: team.service,
    initiatives: initiatives.service,
    attachments: attachments.service,
    office,
    browser: browser.service,
    filesDirOf: attempts.filesDirOf,
    imageAnalysis,
    documentProcessor,
    log,
  });
  mcp.register(server);
  const contextEnabled = () => settings.service.get('ai.contextEngine');
  const directoryManaged = (directory: string): boolean =>
    !!worktrees.service.taskAt(directory) ||
    projects.service.hasDirectory(directory) ||
    directory === decks.service.blankDir ||
    assistant.service.isFilesDirectory(directory) ||
    attempts.service.hasActiveDirectory(directory);
  const summaries = createContextSummaries({
    db: database.db,
    clock,
    log,
    sessions,
    opencode,
    enabled: contextEnabled,
    ownerSignal: (owner, sessionId): AbortSignal | undefined =>
      owner.kind === 'attempt'
        ? attempts.service.delegationSignal(owner.id, sessionId)
        : assistant.service.summarySignal(owner.id, sessionId),
  });
  server.addHook('preClose', async () => {
    summaries.close();
  });
  const snapshots = createBudgetSnapshots();
  const mcpSizes = new Map<string, number>();
  function mcpToolBytes(execution: boolean): number {
    const key = execution ? 'execution' : settings.service.get('ui.mode');
    const cached = mcpSizes.get(key);
    if (cached !== undefined) return cached;
    const size = Buffer.byteLength(JSON.stringify((execution ? mcp : assistant).registry.list()));
    mcpSizes.set(key, size);
    return size;
  }
  async function currentRecallTool(owner: ContextOwner, sessionId: string, directory: string, messageAgent?: string) {
    const permitted =
      owner.kind === 'attempt'
        ? mcp.registry.permits(McpToolName.Recall, attempts.service.get(owner.id))
        : assistant.registry.permits(McpToolName.Recall);
    if (!permitted) return undefined;
    const agent =
      messageAgent ?? (owner.kind === 'attempt' ? attempts.service.liveAgentOf(owner.id) : OPENCODE_ASSISTANT_AGENT);
    return visibleRecallTool(opencode, { kind: owner.kind, sessionId, directory, agent });
  }
  const inspectContext = createContextInspector(
    opencode,
    snapshots,
    summaries,
    prompts,
    mcpToolBytes,
    (directory) => contextEnabled() && directoryManaged(directory),
    currentRecallTool,
  );
  const stopWatchingContext = opencode.subscribe((event) => {
    if (event.type === OpencodeEventType.Compacted || event.type === OpencodeEventType.Deleted)
      snapshots.delete(event.sessionId);
  });
  server.addHook('preClose', async () => {
    stopWatchingContext();
  });
  registerContextRoutes(server, {
    recallTool: currentRecallTool,
    manage: (owner, sessionId, model) =>
      owner.kind === 'attempt'
        ? attempts.service.manageContext(sessionId, model)
        : assistant.service.manageContext(owner.id, model),
    snapshots,
    summaries,
    token: mcpToken,
    enabled: contextEnabled,
    directoryManaged,
    owner: (sessionId, directory) =>
      attempts.service.contextOwner(sessionId, directory) ?? assistant.service.contextOwner(sessionId, directory),
    block: (owner, sessionId) => attempts.service.blockContext(sessionId, owner.id),
    toolBytes: mcpToolBytes,
    log,
  });
  attempts.registerRoutes(server);
  tasks.registerRoutes(server);
  browser.registerRoutes(server);
  attachments.registerRoutes(server);
  const operations: OperationImpl[] = [
    implement(getAssistantContextOp, ({ id }) => inspectContext(assistant.service.contextSource(id))),
    implement(getAttemptContextOp, ({ id }) => inspectContext(attempts.service.contextSource(id))),
    ...settings.operations,
    ...startupEnvironment.operations,
    ...system.operations,
    ...modelSlots.operations,
    ...credentials.operations,
    ...storage.operations,
    ...projects.operations,
    ...projectModules.operations,
    ...projectRuntimeOperations(projectRuntime),
    ...hostingAccounts.operations,
    ...attachments.operations,
    ...previews.operations,
    ...browser.operations,
    ...databases.operations,
    ...roles.operations,
    ...workflows.operations,
    ...skills.operations,
    ...tasks.operations,
    ...functionalTests.operations,
    ...testFollowups.operations,
    ...batches.operations,
    ...initiatives.operations,
    ...schedules.operations,
    ...knowledge.operations,
    ...decks.operations,
    ...designs.operations,
    ...insights.operations,
    ...team.operations,
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
    permissionReviewer,
    databaseInvestigations,
    sessions,
    skills: skills.service,
    browser: browser.service,
    db: database.db,
    unit,
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
    initiatives: initiatives.service,
    gitReviews: gitReviews.service,
    team: team.service,
    attachments: attachments.service,
    office,
    slots: modelSlots.service,
    dataDir: config.dataDir,
    timeZone,
    imageAnalysis,
    documentProcessor,
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
  functionalTests.service.recover();
  testFollowups.recover();
  attempts.service.recover();
  team.service.analyses.recover();
  nodes.service.recover();
  worktrees.service.recover();
  tasks.service.recover();
  initiatives.service.recover();

  if (config.webDir !== undefined) await server.register(fastifyStatic, { root: config.webDir });
  return {
    server,
    events,
    log,
    services: {
      credentials: credentials.service,
      startupEnvironment: startupEnvironment.service,
      databaseInvestigations,
      runtime,
      opencode,
      attempts: attempts.service,
      attachments: attachments.service,
      roles: roles.service,
      workflows: workflows.service,
      tasks: tasks.service,
      functionalTests: functionalTests.service,
      nodes: nodes.service,
      inbox: inbox.service,
      worktrees: worktrees.service,
      previews: previews.service,
      browser: browser.service,
      assistant: assistant.service,
      knowledge: knowledge.service,
      decks: decks.service,
      designs: designs.service,
      schedules: { ...schedules.service, settled: schedules.timer.settled },
      initiatives: initiatives.service,
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
      await databaseInvestigations.cleanup();
      await assistant.start();
    },
    close: () => server.close(),
  };
}
