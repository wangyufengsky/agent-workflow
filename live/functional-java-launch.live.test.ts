import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  FUNCTIONAL_TEST_WORKFLOW_KEY,
  functionalTestReadOp,
  functionalTestReportReadOp,
  getProjectOp,
  MCP_TOOL_PREFIX,
  McpToolName,
  TaskStatus,
  type TranscriptEntry,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { outcome, startLiveApp, TASK_TIMEOUT_MS } from './live-app.ts';

const MODULE_DOC = 'docs/rates-module.md';
const EXPECTED_LAUNCH = {
  directory: 'services/rates/example/rates',
  source: 'services/rates/example/rates/CatalogProbe.java',
  script: 'java-main',
  mainClass: 'example.rates.CatalogProbe',
  readyPath: '/system/ping',
};

it(
  '@live 按项目指引发现 Java 服务入口，启动并提交 HTTP 功能测试报告',
  async () => {
    const live = await startLiveApp('functional-java-launch');
    try {
      const task = await live.runTask(
        FUNCTIONAL_TEST_WORKFLOW_KEY,
        'functional-java-http',
        '请只读验证本项目运费查询服务默认试算的接口契约。结合仓库 AGENTS.md 指引和保存的 IDEA 运行配置核对本地测试入口和预期，实际请求一次并提交带证据的报告。',
        { functionalTest: { target: '/', writes: [], caseAttachmentIds: [] } },
      );
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect((await live.t.call(getProjectOp, { id: task.project.id })).body.preview).toBeNull();

      const dir = join(live.t.dataDir, 'runs', task.id);
      const logs = (await readdir(dir)).filter((name) => name.endsWith('.jsonl'));
      const entries: TranscriptEntry[] = (
        await Promise.all(logs.map((name) => readFile(join(dir, name), 'utf8')))
      ).flatMap((log) =>
        log
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line)),
      );
      const calls = entries.flatMap((entry) => (entry.kind === 'tool_call' ? [entry.data] : []));
      expect(calls).toContainEqual(
        expect.objectContaining({
          tool: 'read',
          input: expect.objectContaining({ filePath: expect.stringContaining(MODULE_DOC) }),
        }),
      );
      expect(calls).toContainEqual(
        expect.objectContaining({
          tool: `${MCP_TOOL_PREFIX}${McpToolName.TestEnvironmentPrepare}`,
          input: expect.objectContaining({ launch: expect.objectContaining(EXPECTED_LAUNCH) }),
        }),
      );

      expect(entries).toContainEqual(
        expect.objectContaining({
          kind: 'tool_result',
          data: expect.objectContaining({
            tool: `${MCP_TOOL_PREFIX}${McpToolName.TestIdeConfigurations}`,
            status: 'completed',
            output: expect.stringContaining(EXPECTED_LAUNCH.mainClass),
          }),
        }),
      );
      const { body: snapshot } = await live.t.call(functionalTestReadOp, { taskId: task.id });
      const environment = snapshot.runs.at(-1)?.environment;
      expect(environment).toMatchObject({
        launch: EXPECTED_LAUNCH,
        ready: true,
        readyStatus: 204,
        verified: true,
        command: expect.stringContaining('CatalogProbe.java'),
        readyUrl: expect.stringMatching(/^http:\/\/127\.0\.0\.1:[1-9]\d*\/system\/ping$/),
      });
      const request = snapshot.events.find(({ kind, detail }) => kind === 'action' && detail.path === '/v1/rate');
      expect(request).toMatchObject({ detail: { method: 'GET', path: '/v1/rate' } });
      const evidence = snapshot.events.filter(
        ({ executionId, step }) => executionId === request?.executionId && step === request?.step,
      );
      expect(evidence).toContainEqual(
        expect.objectContaining({
          kind: 'result',
          detail: expect.objectContaining({ status: 200 }),
        }),
      );
      expect(evidence).toContainEqual(
        expect.objectContaining({
          kind: 'assertion',
          detail: expect.objectContaining({ field: 'body.rate', expected: 23, actual: 23, passed: true }),
        }),
      );
      const { body: report } = await live.t.call(functionalTestReportReadOp, { taskId: task.id });
      expect(report.counts.passed).toBeGreaterThan(0);
      expect(report.counts).toMatchObject({ failed: 0, blocked: 0, not_run: 0 });
      expect(report.markdown).toContain('/v1/rate');
    } finally {
      await live.close();
    }
  },
  TASK_TIMEOUT_MS,
);
