import { readFile } from 'node:fs/promises';
import {
  AssistantConfirmationStatus,
  confirmAssistantCallOp,
  createProjectOp,
  createTaskOp,
  functionalTestReadOp,
  functionalTestReportReadOp,
  getTaskOp,
  listConfirmationsOp,
  listTasksOp,
  MCP_ASSISTANT_TOOL_PREFIX,
  ServerEventType,
  TaskStatus,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { createTestRepo } from '../packages/server/test/helpers/git.ts';
import { during, startAssistantEvaluation } from './assistant-evaluation.ts';
import { TASK_TIMEOUT_MS } from './live-app.ts';

const MODULE = 'example.rates.CatalogProbe';
const DIRECTORY = 'services/rates/example/rates';
const SOURCE = `${DIRECTORY}/CatalogProbe.java`;

it(
  '@live 项目助手识别 Java 模块，经用户确认创建功能测试并交付 HTTP 证据',
  async () => {
    const evaluation = await startAssistantEvaluation('project-modules');
    try {
      const { t } = evaluation;
      const fixture = new URL('./fixtures/functional-java-http/', import.meta.url);
      const repo = await createTestRepo({
        files: {
          [SOURCE]: await readFile(new URL(SOURCE, fixture), 'utf8'),
          [`${DIRECTORY}/README.md`]: [
            '# 运费查询模块',
            '模块类型：HTTP 服务',
            '就绪路径：`/system/ping`',
            'GET /system/ping 应返回 HTTP 204。',
            'GET /v1/rate 默认试算应返回 HTTP 200 和 JSON `{"rate":23,"currency":"CNY"}`，无需账号或写入。',
          ].join('\n'),
          '.run/Rates API local.run.xml': await readFile(new URL('.run/Rates API local.run.xml', fixture), 'utf8'),
        },
      });
      const response = await t.call(createProjectOp, { repoPath: repo.path, name: '运费服务验收项目' });
      expect(response.status).toBe(201);
      const project = response.body;
      expect(project.preview).toBeNull();
      const id = await evaluation.conversation('运费模块功能验收', project.id);
      const turn = await evaluation.turn(
        id,
        'ask-with-module-name',
        '帮我测运费 CatalogProbe 模块，实际试一下默认运费查询的 HTTP 状态和金额。只读验收，先给我确认。',
        { context: { page: 'project', params: { projectId: project.id } } },
      );
      const names = turn.tools.map((tool) => tool.tool);
      const discovery = names.indexOf(`${MCP_ASSISTANT_TOOL_PREFIX}projects_modules`);
      const creation = names.indexOf(`${MCP_ASSISTANT_TOOL_PREFIX}tasks_create`);
      expect(discovery).toBeGreaterThanOrEqual(0);
      expect(creation).toBeGreaterThan(discovery);
      expect(turn.results).toContainEqual(
        expect.objectContaining({
          tool: `${MCP_ASSISTANT_TOOL_PREFIX}projects_modules`,
          output: expect.stringContaining(MODULE),
        }),
      );
      const { body: confirmations } = await t.call(listConfirmationsOp, { id });
      expect(confirmations.items).toHaveLength(1);
      const confirmation = confirmations.items[0];
      expect(confirmation).toMatchObject({
        operationId: createTaskOp.id,
        status: AssistantConfirmationStatus.Pending,
        input: {
          projectId: project.id,
          functionalTest: {
            moduleSelection: {
              moduleId: `java:${SOURCE}`,
              configurationId: expect.any(String),
              fingerprint: expect.any(String),
            },
          },
        },
      });
      if (!confirmation) throw new Error('Expected one task confirmation');
      expect((await t.call(listTasksOp, {})).body.items).toEqual([]);

      const taskId = await during(
        t,
        (event) =>
          event.type === ServerEventType.TaskUpdated &&
          event.data.project.id === project.id &&
          [TaskStatus.Review, TaskStatus.Failed, TaskStatus.Cancelled].some((status) => status === event.data.status),
        async () => {
          const { body, status } = await t.call(confirmAssistantCallOp, { id: confirmation.id });
          evaluation.facts.confirmation = body;
          expect(status).toBe(200);
          expect(body.result?.ok).toBe(true);
          if (body.result?.ok !== true) throw new Error('Task confirmation failed');
          const task = createTaskOp.output.parse(body.result.output);
          evaluation.tasks.add(task.id);
          return task.id;
        },
        TASK_TIMEOUT_MS,
      );

      const { body: task } = await t.call(getTaskOp, { id: taskId });
      const { body: snapshot } = await t.call(functionalTestReadOp, { taskId });
      evaluation.facts.task = task;
      evaluation.facts.snapshot = snapshot;
      expect(task.status).toBe(TaskStatus.Review);
      expect(snapshot.runs.at(-1)?.environment).toMatchObject({
        ready: true,
        readyStatus: 204,
        launch: { directory: DIRECTORY, source: SOURCE, mainClass: MODULE, readyPath: '/system/ping' },
        readyUrl: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/system\/ping$/),
      });
      const action = snapshot.events.find(
        ({ kind, detail }) => kind === 'action' && detail.method === 'GET' && detail.path === '/v1/rate',
      );
      expect(action).toBeDefined();
      const evidence = snapshot.events.filter(
        ({ executionId, step }) => executionId === action?.executionId && step === action?.step,
      );
      expect(evidence).toContainEqual(
        expect.objectContaining({ kind: 'result', detail: expect.objectContaining({ status: 200 }) }),
      );
      expect(evidence).toContainEqual(
        expect.objectContaining({
          kind: 'assertion',
          detail: expect.objectContaining({ field: 'body.rate', actual: 23, passed: true }),
        }),
      );
      const { body: report } = await t.call(functionalTestReportReadOp, { taskId });
      evaluation.facts.report = report;
      expect(report.counts.passed).toBeGreaterThan(0);
      expect(report.counts).toMatchObject({ failed: 0, blocked: 0, not_run: 0 });
      expect(report.markdown).toContain('/v1/rate');
    } finally {
      await evaluation.close();
    }
  },
  TASK_TIMEOUT_MS,
);
