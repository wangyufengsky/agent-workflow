import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  createConversationOp,
  ServerEventType,
  sendAssistantMessageOp,
  type TranscriptPage,
  updateSettingsOp,
} from '@aw/shared';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { renderTemplate } from '../packages/builtin/src/index.ts';
import { createTestApp, type TestApp } from '../packages/server/test/helpers/app.ts';
import { waitForEvent } from '../packages/server/test/helpers/events.ts';
import { TEST_MODEL } from '../packages/server/test/helpers/model.ts';

/** 只验证通知模板的真实模型语义；来源绑定与状态回传由真实 SQLite/Git 集成用例覆盖。 */
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ realOpencode: true });
  await t.app.start(t.port);
  await t.call(updateSettingsOp, { 'ai.defaultModel': TEST_MODEL });
}, 60_000);
afterAll(() => t.close());

it('@live 连续任务通知区分待验收、失败和 PR 创建，跳过检查不报通过且不自动操作', async () => {
  const conversation = (await t.call(createConversationOp, {})).body;
  const waitIdle = () =>
    waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.id === conversation.id && !c.busy, 180_000);
  const initial = waitIdle();
  await t.call(sendAssistantMessageOp, {
    id: conversation.id,
    text: '接下来收到的任务状态通知，请用中文简短回报，明确哪些还需要我检查，不要自动操作。',
    context: { page: 'home', params: {} },
  });
  await initial;
  const template = await readFile(
    new URL('../packages/builtin/prompts/assistant-task-updated.md', import.meta.url),
    'utf8',
  );
  const snapshots = [
    {
      key: 'T-901',
      status: 'review',
      eventType: 'execution_finished',
      result: { summary: '修复日期格式，等待验收', checks: [{ command: 'npm test', passed: false, skipped: true }] },
      delivery: null,
    },
    {
      key: 'T-902',
      status: 'failed',
      eventType: 'fail',
      failedPhase: 'executing',
      failure: { code: 'CHECK_COMMAND_FAILED', message: '唯一失败标记：日期边界断言失败' },
      result: null,
      delivery: null,
    },
    {
      key: 'T-903',
      status: 'completed',
      eventType: 'delivered',
      result: { summary: '修改已推送供审查' },
      delivery: {
        strategy: 'pull_request',
        status: 'succeeded',
        prUrl: 'https://example.com/pull/903',
        commitSha: null,
      },
    },
  ];
  const reports: Array<{ snapshot: unknown; reply: string; tools: string[]; errors: unknown[] }> = [];
  let afterSeq = 0;
  for (const [index, snapshot] of snapshots.entries()) {
    const before = await t.request({ method: 'GET', url: `/assistant/conversations/${conversation.id}/transcript` });
    afterSeq = before.json<TranscriptPage>().entries.at(-1)?.seq ?? afterSeq;
    const idle = waitIdle();
    await t.app.services.assistant.deliver(
      conversation.id,
      renderTemplate(template, {
        snapshot: JSON.stringify({
          taskId: `notification-fixture-${index}`,
          title: '通知语义验收样本',
          link: `/tasks/notification-fixture-${index}`,
          occurredAt: Date.now(),
          ...snapshot,
        }),
      }),
    );
    await idle;
    const response = await t.request({
      method: 'GET',
      url: `/assistant/conversations/${conversation.id}/transcript?afterSeq=${afterSeq}`,
    });
    const entries = response.json<TranscriptPage>().entries;
    const parts = new Map(entries.flatMap((e) => (e.kind === 'text' ? [[e.partId, e.data.text] as const] : [])));
    reports.push({
      snapshot,
      reply: [...parts.values()].join('\n'),
      tools: entries.flatMap((e) => (e.kind === 'tool_call' ? [e.data.tool] : [])),
      errors: entries.filter((e) => e.kind === 'error'),
    });
  }
  await mkdir(new URL('reports/', import.meta.url), { recursive: true });
  await writeFile(
    new URL(`reports/assistant-notifications-${new Date().toISOString().replaceAll(':', '-')}.json`, import.meta.url),
    JSON.stringify({ model: TEST_MODEL, reports }, null, 2),
  );
  for (const [index, report] of reports.entries()) {
    expect(report.errors).toEqual([]);
    expect(report.reply).toContain(`T-90${index + 1}`);
    expect(report.tools).toEqual([]);
  }
  expect(reports[0]?.reply).toMatch(/待.*验收|等待.*验收|需要.*验收/);
  expect(reports[0]?.reply).toMatch(/跳过|未.{0,6}(执行|验证|运行)/);
  expect(reports[1]?.reply).toContain('日期边界断言失败');
  expect(reports[1]?.reply).not.toMatch(/(?:^|[，。；：])(?:因此|所以|故)?(?:未|没有)产生.{0,12}(改动|更改|变更)/);
  expect(reports[2]?.reply).toMatch(/(未|没有|尚未).{0,6}合并|等待.{0,6}(审查|合并)/);
});
