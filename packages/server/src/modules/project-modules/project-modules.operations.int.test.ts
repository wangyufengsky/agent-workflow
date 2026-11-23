import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  AttemptStatus,
  createTaskOp,
  defaultProjectModuleOp,
  ErrorCode,
  FUNCTIONAL_TEST_NODE,
  FUNCTIONAL_TEST_WORKFLOW_KEY,
  functionalTestReadOp,
  functionalTestRepairOp,
  functionalTestRerunOp,
  functionalTestRunSchema,
  getProjectModulesOp,
  getTaskOp,
  MCP_SESSION_ARG,
  McpToolName,
  type ProjectModuleRun,
  rediscoverProjectModulesOp,
  ServerEventType,
  startProjectModuleRunOp,
  startTaskOp,
  stopProjectModuleRunOp,
  TaskStatus,
} from '@aw/shared';
import { execa } from 'execa';
import { expect, it, vi } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';
import { addProject, workflowId } from '../../../test/helpers/tasks.ts';
import { DATABASE_FILE } from '../../core/db/database.ts';
import { host } from '../../core/platform.ts';

const JAVA = `import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
class Probe {
  public static void main(String[] args) throws Exception {
    System.out.println("trial-started apiKey=hide-this-value");
    if (System.getenv("AW_API_TOKEN") != null) throw new AssertionError("API token reached child");
    HttpServer server = HttpServer.create(new InetSocketAddress(System.getProperty("server.address"),
      Integer.parseInt(System.getProperty("server.port"))), 0);
    server.createContext("/health", exchange -> {
      byte[] bytes = "real-java-trial".getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200, bytes.length);
      exchange.getResponseBody().write(bytes);
      exchange.close();
    });
    server.start();
  }
}`;

async function usableJava(): Promise<boolean> {
  const directories = host.pathDirs(process.env);
  const java = host.findExecutable('java', directories);
  if (java === undefined || host.findExecutable('javac', directories) === undefined) return false;
  const result = await execa(java, ['-XshowSettings:properties', '-version'], { reject: false, timeout: 5000 });
  const major = Number(/^\s*java\.version\s*=\s*(\d+)/m.exec(result.stderr)?.[1]);
  return result.exitCode === 0 && major >= 11;
}

it('discovers Java modules by baseline and refreshes their catalog through the project operations', async () => {
  const t = await createTestApp();
  try {
    const { project, repo } = await addProject(t, {
      files: {
        'service/Probe.java': JAVA,
        'service/README.md': 'Readiness path: /health',
      },
    });
    const request = { id: project.id };
    const first = await t.call(getProjectModulesOp, request);
    expect(first.status).toBe(200);
    expect(first.body.baseline).toBe(await repo.git('rev-parse', 'HEAD'));
    expect(first.body.modules[0]).toMatchObject({
      build: 'standalone',
      configurations: [{ launch: { readyPath: '/health' } }],
    });
    await writeFile(join(repo.path, 'service/README.md'), 'Readiness path: /new');
    const dirty = await t.call(rediscoverProjectModulesOp, request);
    expect(dirty.body.modules).toEqual(first.body.modules);
    await repo.git('add', 'service/README.md');
    await repo.git('commit', '-m', 'Change readiness path');
    const refresh = await t.call(rediscoverProjectModulesOp, request);
    expect(refresh.status).toBe(200);
    expect(refresh.body.baseline).not.toBe(first.body.baseline);
    expect(refresh.body.modules[0]).toMatchObject({ configurations: [{ launch: { readyPath: '/new' } }] });
    expect((await t.call(getProjectModulesOp, request)).body.modules).toEqual(refresh.body.modules);
  } finally {
    await t.close();
  }
});

it.skipIf(!(await usableJava()))(
  'starts and stops real Java, preserves a verified default and transfers its pinned launch to a task',
  async () => {
    const env = { ...process.env, AW_API_TOKEN: 'test-task-runtime-token' };
    let t = await createTestApp({ env });
    try {
      const { project, repo } = await addProject(t, {
        files: {
          'service/Probe.java': JAVA,
          'service/README.md': 'Readiness path: /health',
        },
      });
      const request = { id: project.id };
      const { body: catalog } = await t.call(getProjectModulesOp, request);
      const module = catalog.modules[0];
      const config = module?.configurations[0];
      if (module === undefined || config?.launch == null) throw new Error('Expected a discovered Java launch');
      const moduleSelection = { moduleId: module.id, configurationId: config.id, fingerprint: config.fingerprint };

      const unverified = await t.call(defaultProjectModuleOp, { ...request, ...moduleSelection });
      expect(unverified.status).toBeGreaterThanOrEqual(400);
      const { status, body: run } = await t.call(startProjectModuleRunOp, {
        ...request,
        ...moduleSelection,
        baseline: catalog.baseline,
      });
      expect(status).toBe(200);
      const ready = await vi.waitFor(
        async () => {
          const response = await t.call(getProjectModulesOp, request);
          const active = response.body.runs.find((item) => item.id === run.id);
          expect(active).toMatchObject({ status: 'ready', readyStatus: 200 });
          return active;
        },
        { timeout: 15_000 },
      );
      if (ready?.readyUrl == null) throw new Error('Expected a real Java trial URL');
      expect(await (await fetch(ready.readyUrl)).text()).toBe('real-java-trial');
      const runtime = ready.services?.find(({ id }) => id === module.id);
      expect(runtime?.diagnostics).toMatchObject({
        workingDirectory: 'service',
        javaVersion: expect.any(Number),
        manager: 'java',
        managedVmOptions: ['server.port', 'server.address'],
        requested: { workingDirectory: 'service' },
      });
      expect(runtime?.diagnostics?.requested?.javaVersion).toBeUndefined();
      expect(ready.log).toContain('trial-started apiKey=[redacted]');
      expect(ready.log).not.toContain('hide-this-value');
      const stopped = await t.call(stopProjectModuleRunOp, { ...request, runId: run.id });
      expect(stopped.body).toMatchObject({ status: 'stopped', finishedAt: expect.any(Number) });
      await expect(fetch(ready.readyUrl)).rejects.toThrow();

      const saved = await t.call(defaultProjectModuleOp, { ...request, ...moduleSelection });
      expect(saved.status).toBe(200);
      expect(saved.body.defaults[module.id]).toBe(config.id);
      const { dataDir } = t;
      await t.close();
      t = await createTestApp({ dataDir, env });
      const recovered = await t.call(getProjectModulesOp, request);
      expect(recovered.body.defaults[module.id]).toBe(config.id);
      expect(recovered.body.runs).toContainEqual(expect.objectContaining({ id: run.id, status: 'stopped' }));

      const taskInput = {
        projectId: project.id,
        workflowId: await workflowId(t, FUNCTIONAL_TEST_WORKFLOW_KEY),
        requirement: 'Check the selected service health endpoint',
        start: false,
        functionalTest: { target: '/health', writes: [], caseAttachmentIds: [], moduleSelection },
      };
      const created = await t.call(createTaskOp, taskInput);
      expect(created.status).toBe(201);
      const pinned = {
        moduleSelection,
        moduleLaunch: {
          moduleName: module.name,
          configurationName: config.name,
          launch: config.launch,
        },
      };
      expect(created.body.functionalTest).toMatchObject(pinned);
      expect((await t.call(getTaskOp, { id: created.body.id })).body.functionalTest).toMatchObject(pinned);

      await writeFile(join(repo.path, 'service/Probe.java'), JAVA.replace('real-java-trial', 'new-java-revision'));
      await writeFile(join(repo.path, 'service/README.md'), 'Readiness path: /changed');
      await repo.git('add', 'service/Probe.java', 'service/README.md');
      await repo.git('commit', '-m', 'Change the module evidence after saving the task');
      const branchHead = await repo.git('rev-parse', 'HEAD');
      expect(branchHead).not.toBe(catalog.baseline);

      const taskId = created.body.id;
      const mcp = await connectMcp(t.mcpUrl, t.app.mcpToken);
      try {
        const stage = (key: string, title: string) => {
          t.fake.enqueue(script().hang(), { title });
          return waitForEvent(
            t.app.events,
            ServerEventType.AttemptUpdated,
            ({ attempt, nodeId, taskId: id }) =>
              id === taskId &&
              attempt.status === AttemptStatus.Running &&
              t.app.services.tasks.detail(id).nodes.some((node) => node.id === nodeId && node.key === key),
          );
        };
        const runTool = async (attemptId: string, name: McpToolName, input: Record<string, unknown> = {}) => {
          const session = t.app.services.attempts.get(attemptId).opencodeSessionId;
          const result = await callTool(mcp, name, { ...input, [MCP_SESSION_ARG]: session });
          expect(result.isError, JSON.stringify(result.body)).toBe(false);
          return result.body;
        };

        const authored = stage(FUNCTIONAL_TEST_NODE.Author, '编写案例');
        await t.call(startTaskOp, { id: taskId });
        const { attempt } = await authored;
        const { body: activeTask } = await t.call(getTaskOp, { id: taskId });
        expect(activeTask.git.baseCommit).toBe(catalog.baseline);
        expect(activeTask.functionalTest?.moduleLaunch).toMatchObject({ baseline: catalog.baseline });
        const worktree = t.app.services.worktrees.findByTask(taskId);
        expect(worktree?.baseCommit).toBe(catalog.baseline);
        await runTool(attempt.id, McpToolName.TestCaseSave, {
          title: 'Health returns 200',
          requirement: 'Selected service health check',
          steps: [
            {
              kind: 'http',
              title: 'Check health',
              method: 'GET',
              path: '/health',
              assertions: [{ field: 'status', equals: 200, basis: 'Fixture source' }],
            },
          ],
        });
        const environment = stage(FUNCTIONAL_TEST_NODE.Environment, '准备环境');
        await runTool(attempt.id, McpToolName.SubmitResult, { summary: 'Saved health test' });
        const prepared = functionalTestRunSchema.parse(
          await runTool((await environment).attempt.id, McpToolName.TestEnvironmentPrepare),
        );
        expect(prepared.environment).toMatchObject({ ready: true, launch: config.launch, baseline: catalog.baseline });
        expect(await (await fetch(prepared.environment.target)).text()).toBe('real-java-trial');
        expect(prepared.environment.diagnostics).toMatchObject({
          javaVersion: expect.any(Number),
          manager: 'java',
          requested: { workingDirectory: 'service' },
        });
        const session = t.app.services.attempts.get((await environment).attempt.id).opencodeSessionId;
        const invalid = await callTool(mcp, McpToolName.TestEnvironmentPrepare, {
          [MCP_SESSION_ARG]: session,
          checks: [{ key: 'foreign', serviceId: 'unknown', path: '/health', expectedStatus: 200 }],
        });
        expect(invalid.isError).toBe(true);
        expect(await (await fetch(prepared.environment.target)).text()).toBe('real-java-trial');
      } finally {
        await mcp.close();
      }

      const rediscovered = await t.call(rediscoverProjectModulesOp, request);
      expect(rediscovered.body.baseline).toBe(branchHead);
      expect(rediscovered.body.defaults[module.id]).toBeUndefined();
      expect(rediscovered.body.modules[0]?.configurations[0]?.fingerprint).not.toBe(config.fingerprint);
      const stale = await t.call(createTaskOp, taskInput);
      expect(stale.status).toBeGreaterThanOrEqual(400);
      expect(stale.raw.json()).toMatchObject({ error: { code: ErrorCode.ValidationFailed } });
      expect((await t.call(getTaskOp, { id: created.body.id })).body.functionalTest).toMatchObject(pinned);
    } finally {
      await t.close();
    }
  },
  45_000,
);

it('interrupts only in-flight records when the server recovers and keeps terminal history on stop', async () => {
  const first = await createTestApp();
  const { project, repo } = await addProject(first);
  const baseline = await repo.git('rev-parse', 'HEAD');
  await first.close();

  const statuses = ['starting', 'ready', 'running', 'passed', 'failed', 'stopped', 'interrupted'] as const;
  const database = new DatabaseSync(join(first.dataDir, DATABASE_FILE));
  try {
    const insert = database.prepare(
      'INSERT INTO project_module_runs (id, project_id, started_at, result) VALUES (?, ?, ?, ?)',
    );
    for (const status of statuses) {
      const run: ProjectModuleRun = {
        id: status,
        projectId: project.id,
        moduleId: 'module',
        configurationId: null,
        fingerprint: baseline,
        baseline,
        kind: status === 'running' || status === 'passed' ? 'checks' : 'launch',
        checkIds: [],
        status,
        startedAt: 1,
        finishedAt: ['passed', 'failed', 'stopped'].includes(status) ? 2 : null,
        log: `recorded ${status}`,
        readyUrl: null,
        readyStatus: null,
      };
      insert.run(run.id, run.projectId, run.startedAt, JSON.stringify(run));
    }
  } finally {
    database.close();
  }

  const restarted = await createTestApp({ dataDir: first.dataDir });
  try {
    const { body } = await restarted.call(getProjectModulesOp, { id: project.id });
    const runs = new Map(body.runs.map((run) => [run.id, run]));
    for (const id of ['starting', 'ready', 'running']) {
      expect(runs.get(id)).toMatchObject({ status: 'interrupted', log: `recorded ${id}` });
      expect(runs.get(id)?.finishedAt).toBeGreaterThan(2);
    }
    for (const id of ['passed', 'failed', 'stopped', 'interrupted']) {
      const stop = await restarted.call(stopProjectModuleRunOp, { id: project.id, runId: id });
      expect(stop.status).toBe(200);
      expect(stop.body).toMatchObject({
        status: id,
        finishedAt: id === 'interrupted' ? null : 2,
        log: `recorded ${id}`,
      });
    }
  } finally {
    await restarted.close();
  }
});

it('discovers shared and local IDEA Compound members and pins a validated service target onto a functional task', async () => {
  const t = await createTestApp();
  try {
    const application = (
      name: string,
      directory: string,
      main: string,
    ) => `<configuration name="${name}" type="Application">
      <option name="MAIN_CLASS_NAME" value="${main}"/>
      <option name="WORKING_DIRECTORY" value="$PROJECT_DIR$/${directory}"/>
    </configuration>`;
    const member = (name: string, type = 'Application') => `<toRun name="${name}" type="${type}"/>`;
    const compound = (name: string, entries: string) =>
      `<configuration name="${name}" type="CompoundRunConfigurationType">${entries}</configuration>`;
    const shared = (...parts: string[]) =>
      `<component name="ProjectRunConfigurationManager">${parts.join('')}</component>`;
    const { project, repo } = await addProject(t, {
      files: {
        'api/Probe.java': JAVA,
        'api/README.md': 'Readiness path: /health',
        'upstream/Upstream.java': JAVA.replace('class Probe', 'class Upstream'),
        'upstream/README.md': 'Readiness path: /health',
        '.idea/runConfigurations/Group.xml': shared(
          application('API', 'api', 'Probe'),
          application('Injected API', 'api', 'Probe').replace(
            '</configuration>',
            '<envs><env name="UPSTREAM_URL" value="https://configured-but-never-executed.invalid"/></envs></configuration>',
          ),
          application('Upstream', 'upstream', 'Upstream'),
          compound('Stack', member('Injected API') + member('Upstream')),
          compound('Unmapped', member('Injected API') + member('Upstream')),
          compound('Cycle', member('API') + member('Upstream')),
          compound('Independent', member('Upstream') + member('API')),
          compound('Missing', member('NoSuchService')),
          '<configuration name="Batch" type="ShellScriptRunConfiguration"/>',
          compound('Unsupported', member('Batch', 'ShellScriptRunConfiguration')),
        ),
        '.aw/compound-services.json': JSON.stringify({
          compounds: [
            {
              name: 'Stack',
              target: 'Injected API',
              services: [{ name: 'Injected API', dependsOn: ['Upstream'], inject: { UPSTREAM_URL: 'Upstream' } }],
            },
            {
              name: 'Cycle',
              services: [
                { name: 'API', dependsOn: ['Upstream'] },
                { name: 'Upstream', dependsOn: ['API'] },
              ],
            },
          ],
        }),
        '.idea/.gitignore': 'workspace.xml\n',
      },
    });
    await writeFile(
      join(repo.path, '.idea/workspace.xml'),
      `<project><component name="RunManager">
      ${compound('Private', member('API') + member('Upstream'))}
      ${application('API', 'api', 'Probe')}
    </component></project>`,
    );
    const request = { id: project.id };
    const { body: catalog } = await t.call(getProjectModulesOp, request);
    expect(JSON.stringify(catalog)).not.toContain('configured-but-never-executed');
    const stack = catalog.compounds?.find((item) => item.name === 'Stack');
    if (!stack?.plan) throw new Error('Expected a runnable Compound');
    const [api, upstream] = stack.plan.services;
    if (!api || !upstream) throw new Error('Expected both services');
    expect(stack).toMatchObject({
      scope: 'project',
      source: '.idea/runConfigurations/Group.xml',
      metadataSource: '.aw/compound-services.json',
      members: [
        { name: 'Injected API', status: 'resolved', scope: 'project' },
        { name: 'Upstream', status: 'resolved' },
      ],
      plan: {
        targetServiceId: api.id,
        services: [
          { id: api.id, dependsOn: [upstream.id], inject: [{ env: 'UPSTREAM_URL', serviceId: upstream.id }] },
          { id: upstream.id, dependsOn: [], inject: [] },
        ],
      },
    });
    expect(catalog.compounds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Cycle',
          plan: null,
          review: expect.arrayContaining(['cyclic Compound service dependencies']),
        }),
        expect.objectContaining({
          name: 'Independent',
          plan: {
            targetServiceId: upstream.id,
            services: [
              expect.objectContaining({ name: 'Upstream', dependsOn: [] }),
              expect.objectContaining({ name: 'API', dependsOn: [] }),
            ],
          },
        }),
        expect.objectContaining({
          name: 'Missing',
          plan: null,
          members: [expect.objectContaining({ status: 'missing' })],
        }),
        expect.objectContaining({
          name: 'Unsupported',
          plan: null,
          members: [expect.objectContaining({ status: 'unsupported' })],
        }),
        expect.objectContaining({
          name: 'Private',
          scope: 'local',
          source: '.idea/workspace.xml',
          plan: null,
          members: [expect.objectContaining({ status: 'ambiguous' }), expect.objectContaining({ status: 'resolved' })],
        }),
      ]),
    );

    const workflow = await workflowId(t, FUNCTIONAL_TEST_WORKFLOW_KEY);
    const selection = { compoundId: stack.id, fingerprint: stack.fingerprint, targetServiceId: upstream.id };
    const draft = { projectId: project.id, workflowId: workflow, requirement: 'Test upstream', start: false };
    const functionalTest = { target: '/', writes: [], caseAttachmentIds: [] };
    const created = await t.call(createTaskOp, {
      ...draft,
      functionalTest: { ...functionalTest, compoundSelection: selection },
    });
    expect(created.status).toBe(201);
    expect((await t.call(getTaskOp, { id: created.body.id })).body.functionalTest).toMatchObject({
      compoundSelection: selection,
      compoundLaunch: {
        baseline: catalog.baseline,
        compoundName: 'Stack',
        plan: { ...stack.plan, targetServiceId: upstream.id },
      },
    });
    const outside = await t.call(createTaskOp, {
      ...draft,
      functionalTest: { ...functionalTest, compoundSelection: { ...selection, targetServiceId: 'outside' } },
    });
    expect(outside.status).toBeGreaterThanOrEqual(400);
    await writeFile(
      join(repo.path, '.aw/compound-services.json'),
      JSON.stringify({ compounds: [{ name: 'Stack', target: 'Upstream' }] }),
    );
    await repo.git('add', '.aw/compound-services.json');
    await repo.git('commit', '-m', 'Change Compound routing');
    const updated = await t.call(rediscoverProjectModulesOp, request);
    expect(updated.body.compounds?.find((item) => item.id === stack.id)?.fingerprint).not.toBe(stack.fingerprint);
    const stale = await t.call(createTaskOp, {
      ...draft,
      functionalTest: { ...functionalTest, compoundSelection: selection },
    });
    expect(stale.status).toBeGreaterThanOrEqual(400);
  } finally {
    await t.close();
  }
});

it.skipIf(!(await usableJava()))(
  'tests two real service endpoints, carries the failing member into a fix and reruns its original case at the repaired commit',
  async () => {
    const t = await createTestApp();
    const mcp = await connectMcp(t.mcpUrl, t.app.mcpToken);
    try {
      const makeSource = (name: string, body: string) =>
        JAVA.replace('class Probe', `class ${name}`).replace(
          'server.start();',
          `server.createContext("/quote", exchange -> { ${body}
        System.out.println("quote-handled-${name}");
        exchange.sendResponseHeaders(200, bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
      }); server.start();`,
        );
      const amount = 'byte[] bytes = "{\\"amount\\":12}".getBytes(StandardCharsets.UTF_8);';
      const backend = makeSource('Rates', amount);
      const gateway = makeSource(
        'Gateway',
        'byte[] bytes = new java.net.URL(System.getenv("RATES_URL") + "/quote").openStream().readAllBytes();',
      );
      const names = ['Gateway', 'Rates'];
      const { project, repo } = await addProject(t, {
        files: {
          'rates/Rates.java': backend,
          'gateway/Gateway.java': gateway,
          'gateway/README.md': 'Readiness path: /health',
          'rates/README.md': 'Readiness path: /health',
          '.run/Stack.run.xml':
            '<component name="ProjectRunConfigurationManager">' +
            names
              .map(
                (name) =>
                  `<configuration type="Application" name="${name}"><option name="MAIN_CLASS_NAME" value="${name}"/><option name="WORKING_DIRECTORY" value="$PROJECT_DIR$/${name.toLowerCase()}"/></configuration>`,
              )
              .join('') +
            '<configuration type="CompoundRunConfigurationType" name="Stack">' +
            names.map((name) => `<toRun name="${name}" type="Application"/>`).join('') +
            '</configuration></component>',
          '.aw/compound-services.json': JSON.stringify({
            compounds: [
              {
                name: 'Stack',
                target: 'Gateway',
                services: [{ name: 'Gateway', dependsOn: ['Rates'], inject: { RATES_URL: 'Rates' } }],
              },
            ],
          }),
        },
      });
      const catalog = (await t.call(getProjectModulesOp, { id: project.id })).body;
      const stack = catalog.compounds?.[0];
      const rates = stack?.plan?.services.find((s) => s.name === 'Rates');
      if (!stack?.plan || !rates) throw new Error(JSON.stringify(stack?.review));
      const selection = { compoundId: stack.id, fingerprint: stack.fingerprint };
      const draft = await t.call(createTaskOp, {
        projectId: project.id,
        workflowId: await workflowId(t, FUNCTIONAL_TEST_WORKFLOW_KEY),
        requirement: '核对两个服务的报价，结果应为 23',
        functionalTest: {
          target: '/',
          writes: [{ method: 'POST', path: '/quote', serviceId: rates.id }],
          caseAttachmentIds: [],
          compoundSelection: selection,
        },
        start: false,
      });
      expect(draft.status).toBe(201);
      const id = draft.body.id;
      const stage = (key: string, title: string, taskId?: string) => {
        t.fake.enqueue(script().hang(), { title });
        return waitForEvent(
          t.app.events,
          ServerEventType.AttemptUpdated,
          ({ attempt, taskId: owner, nodeId }) =>
            owner !== null &&
            (taskId === undefined || owner === taskId) &&
            attempt.status === AttemptStatus.Running &&
            t.app.services.tasks.detail(owner).nodes.some((n) => n.id === nodeId && n.key === key),
        );
      };
      const must = async (attempt: string, name: McpToolName, args: Record<string, unknown> = {}) => {
        const result = await callTool(mcp, name, {
          ...args,
          [MCP_SESSION_ARG]: t.app.services.attempts.get(attempt).opencodeSessionId,
        });
        expect(result.isError, JSON.stringify(result.body)).toBe(false);
        return result.body;
      };
      const authored = stage(FUNCTIONAL_TEST_NODE.Author, '编写案例', id);
      await t.call(startTaskOp, { id });
      const author = (await authored).attempt.id;
      const testCase = await must(author, McpToolName.TestCaseSave, {
        title: '网关和运费',
        requirement: '运费为 23',
        requires: ['ready_rates'],
        steps: [
          {
            kind: 'http',
            title: '网关可用',
            method: 'GET',
            path: '/quote',
            assertions: [{ field: 'status', equals: 200, basis: '报价契约' }],
          },
          {
            kind: 'http',
            serviceId: rates.id,
            title: '运费',
            method: 'POST',
            path: '/quote',
            assertions: [{ field: 'body.amount', equals: 23, basis: '报价契约' }],
          },
        ],
      });
      const outside = await must(author, McpToolName.TestCaseSave, {
        title: '同路径的网关未授权写入',
        requirement: '验证成员写权限隔离',
        steps: [
          {
            kind: 'http',
            title: '网关写入',
            method: 'POST',
            path: '/quote',
            assertions: [{ field: 'status', equals: 200, basis: '仅上游授权' }],
          },
        ],
      });
      const prepared = stage(FUNCTIONAL_TEST_NODE.Environment, '准备环境', id);
      await must(author, McpToolName.SubmitResult, { summary: '选定报价用例' });
      async function runCase(taskId: string, attempt: string, executionId: string, first: boolean) {
        const run = functionalTestRunSchema.parse(
          await must(
            attempt,
            McpToolName.TestEnvironmentPrepare,
            first
              ? { checks: [{ key: 'ready_rates', serviceId: rates?.id, path: '/health', expectedStatus: 200 }] }
              : {},
          ),
        );
        expect(run.environment).toMatchObject({
          ready: true,
          checks: [{ key: 'ready_rates', serviceId: rates?.id, ready: true }],
        });
        expect(new Set(run.environment.services?.map((s) => s.target)).size).toBe(2);
        const executing = stage(FUNCTIONAL_TEST_NODE.Execute, '执行测试', taskId);
        await must(attempt, McpToolName.SubmitResult, { summary: '就绪已核实' });
        const executor = (await executing).attempt.id;
        const result = await must(executor, McpToolName.TestCaseRun, {
          caseId: testCase.id,
          runId: run.id,
          version: 1,
          executionId,
        });
        expect(result.status).toBe(first ? 'failed' : 'passed');
        const executionIds = [executionId];
        if (first) {
          const blocked = await must(executor, McpToolName.TestCaseRun, {
            caseId: outside.id,
            runId: run.id,
            version: 1,
            executionId: 'unapproved-gateway',
          });
          expect(blocked.status).toBe('blocked');
          executionIds.push('unapproved-gateway');
        }
        const reporting = stage(FUNCTIONAL_TEST_NODE.Report, '测试报告', taskId);
        await must(executor, McpToolName.SubmitResult, { summary: '已保存实测结果' });
        const writer = (await reporting).attempt.id;
        const report = await must(writer, McpToolName.TestReportSubmit, { runId: run.id, executionIds });
        expect(report.counts).toMatchObject(first ? { failed: 1 } : { passed: 1 });
        await must(writer, McpToolName.SubmitResult, { summary: '报告完成' });
        for (const member of run.environment.services ?? [])
          if (member.target) await expect(fetch(member.target)).rejects.toThrow();
        return run;
      }
      const initial = await runCase(id, (await prepared).attempt.id, 'first', true);
      const evidence = (await t.call(functionalTestReadOp, { taskId: id })).body;
      expect(evidence.events).toContainEqual(
        expect.objectContaining({
          kind: 'assertion',
          detail: expect.objectContaining({
            serviceId: rates.id,
            moduleId: rates.moduleId,
            actual: 12,
            expected: 23,
            passed: false,
            serviceLog: expect.stringContaining('quote-handled-Rates'),
          }),
        }),
      );
      const executions = { taskId: id, executionIds: ['first'] };
      const ready = waitForEvent(
        t.app.events,
        ServerEventType.TaskUpdated,
        (row) => row.workflow.key === 'bugfix' && row.status === TaskStatus.Running,
      );
      t.fake.enqueue(script().hang(), { title: '定位根因' });
      const repair = await t.call(functionalTestRepairOp, executions);
      expect(repair.status).toBe(200);
      const fix = (await t.call(getTaskOp, { id: (await ready).id })).body;
      expect(fix.id).toBe(repair.body.taskId);
      expect(fix.requirement).toContain('quote-handled-Rates');
      const dir = fix.git.worktreePath;
      if (!dir) throw new Error('Missing repair checkout');
      await writeFile(join(dir, 'rates/Rates.java'), backend.replace(':12}', ':23}'));
      await repo.git('-C', dir, 'commit', '-am', 'Fix the service rate');
      const ref = await repo.git('-C', dir, 'rev-parse', 'HEAD');
      const repeated = stage(FUNCTIONAL_TEST_NODE.Environment, '准备环境');
      const followup = await t.call(functionalTestRerunOp, { ...executions, ref });
      expect(followup.status).toBe(200);
      const rerun = await runCase(followup.body.taskId, (await repeated).attempt.id, 'corrected', false);
      expect(rerun.environment.baseline).toBe(ref);
      expect(rerun.environment.baseline).not.toBe(initial.environment.baseline);
    } finally {
      await mcp.close();
      await t.close();
    }
  },
  90_000,
);
