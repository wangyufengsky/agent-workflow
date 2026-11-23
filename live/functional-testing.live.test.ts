import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ATTACHMENT_NAME_HEADER,
  attachmentSchema,
  FUNCTIONAL_TEST_WORKFLOW_KEY,
  FunctionalTestStatus,
  functionalTestReadOp,
  functionalTestReportReadOp,
  MCP_TOOL_PREFIX,
  McpToolName,
  TaskStatus,
  type TranscriptEntry,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { SkillName } from '../packages/builtin/src/skills.ts';
import { type LiveApp, outcome, startLiveApp, TASK_TIMEOUT_MS } from './live-app.ts';

const CASES = `# 待办模块验收用例

## FT-FIELD · 完成字段

- 步骤：POST /api/check，传入 JSON {"state":true}。
- 预期：返回 200，响应 JSON accepted 为 true。依据《待办接口契约》§1。
- 原步骤由旧文档转写。先保留原用例及实测，再按当前契约核对字段。

## FT-STATE · 完成后重读

- 步骤 1：PATCH /api/todos/fixture-1，传入 JSON {"done":true}。预期状态码 200。
- 步骤 2：GET /api/todos/fixture-1。预期响应 JSON done 为 true。
- 两个预期的依据：《待办接口契约》§2。
`;

const CONTRACT = `# 待办接口契约

§1 校验完成字段。POST /api/check 接受 JSON {"done":true} 并返回 200 和 {"accepted":true}。
字段名固定为 done。传 state 应返回 400 和 {"accepted":false}。

§2 保存完成状态。PATCH /api/todos/fixture-1 接受 {"done":true}，返回状态码 200。
之后 GET /api/todos/fixture-1 返回状态码 200、JSON 字段 done 为 true。
测试环境已经预置本轮专用数据 fixture-1，可直接更新和读取。
`;

async function upload(live: LiveApp, filename: string, content: string): Promise<string> {
  const response = await live.t.request({
    method: 'POST',
    url: '/attachments',
    headers: { 'content-type': 'application/octet-stream', [ATTACHMENT_NAME_HEADER]: filename },
    payload: Buffer.from(content),
  });
  expect(response.statusCode).toBe(201);
  return attachmentSchema.parse(response.json()).id;
}

async function successfulCalls(live: LiveApp, taskId: string) {
  const dir = join(live.t.dataDir, 'runs', taskId);
  const names = (await readdir(dir)).filter((name) => name.endsWith('.jsonl'));
  return Promise.all(
    names.map(async (name) => {
      const entries: TranscriptEntry[] = (await readFile(join(dir, name), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const skills = entries.flatMap((entry) =>
        entry.kind === 'tool_call' && entry.data.tool === 'skill' ? [entry.data.input.name] : [],
      );
      const tools = entries.flatMap((entry) =>
        entry.kind === 'tool_result' && entry.data.status === 'completed' ? [entry.data.tool] : [],
      );
      return { skills, tools };
    }),
  );
}

it(
  '@live 导入待办案例，区分转写错误和实测缺陷并发布报告',
  async () => {
    const live = await startLiveApp('functional-testing');
    try {
      const cases = await upload(live, 'cases.md', CASES);
      const contract = await upload(live, 'contract.md', CONTRACT);
      const task = await live.runTask(
        FUNCTIONAL_TEST_WORKFLOW_KEY,
        'functional-todo',
        '验证待办模块的完成字段及完成状态持久化。cases.md 是用户提供的原用例。先保留两条用例的原步骤和预期，执行后根据已确认且适用于此版本的 openapi.json 与其文字说明 contract.md 判断问题归属。修订时传入 contractPath 为 openapi.json，仅替换实测证实为转写错误的请求步骤 body 内对应字段。保留定义中其他所有字段的原值，包括标题、数据说明、步骤标题、断言和依据。对转写错误按契约修订并复测，对产品缺陷保留原实测，最后出报告。',
        {
          attachmentIds: [cases, contract],
          functionalTest: {
            target: '/',
            writes: [
              { method: 'POST', path: '/api/check' },
              { method: 'PATCH', path: '/api/todos/fixture-1' },
            ],
            caseAttachmentIds: [cases],
          },
        },
      );
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      const calls = await successfulCalls(live, task.id);
      expect(calls.filter(({ skills }) => skills.includes(SkillName.FunctionalTesting))).toHaveLength(4);
      const tools = calls.flatMap(({ tools }) => tools);
      expect(tools).toEqual(
        expect.arrayContaining(
          [
            McpToolName.TestCaseSave,
            McpToolName.TestEnvironmentPrepare,
            McpToolName.TestCaseRun,
            McpToolName.TestRunRead,
            McpToolName.TestCaseRevise,
            McpToolName.TestReportSubmit,
          ].map((tool) => `${MCP_TOOL_PREFIX}${tool}`),
        ),
      );

      const { body: snapshot } = await live.t.call(functionalTestReadOp, { taskId: task.id });
      const field = snapshot.cases.find((item) => item.source?.originalId === 'FT-FIELD');
      const state = snapshot.cases.find((item) => item.source?.originalId === 'FT-STATE');
      expect(field).toMatchObject({ source: { attachmentId: cases } });
      expect(state).toMatchObject({ source: { attachmentId: cases } });
      expect(snapshot.executions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ caseId: field?.id, version: 1 }),
          expect.objectContaining({ caseId: field?.id, version: 2, status: FunctionalTestStatus.Passed }),
          expect.objectContaining({ caseId: state?.id, version: 1, status: FunctionalTestStatus.Failed }),
        ]),
      );
      const { body: report } = await live.t.call(functionalTestReportReadOp, { taskId: task.id });
      expect(report.counts).toEqual({ passed: 1, failed: 1, blocked: 0, not_run: 0 });
      expect(report.markdown).toContain('/api/todos/fixture-1');
    } finally {
      await live.close();
    }
  },
  TASK_TIMEOUT_MS,
);
