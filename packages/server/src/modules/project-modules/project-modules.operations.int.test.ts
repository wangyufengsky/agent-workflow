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
