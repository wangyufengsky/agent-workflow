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
import { replyOf } from './assistant-evaluation.ts';

/** 只验证通知模板的真实模型语义；来源绑定与状态回传由真实 SQLite/Git 集成用例覆盖。 */
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ realOpencode: true });
  await t.app.start(t.port);
  await t.call(updateSettingsOp, { 'ai.defaultModel': TEST_MODEL });
}, 60_000);
afterAll(() => t.close());

const idleOf = (conversationId: string) =>
  waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.id === conversationId && !c.busy, 180_000);

/** Delivers one app notification to the conversation and returns the assistant's turn on it. */
async function relay(conversationId: string, message: string) {
  const before = await t.request({ method: 'GET', url: `/assistant/conversations/${conversationId}/transcript` });
  const afterSeq = before.json<TranscriptPage>().entries.at(-1)?.seq ?? 0;
  const idle = idleOf(conversationId);
  await t.app.services.assistant.deliver(conversationId, message);
  await idle;
  const response = await t.request({
    method: 'GET',
    url: `/assistant/conversations/${conversationId}/transcript?afterSeq=${afterSeq}`,
  });
  const entries = response.json<TranscriptPage>().entries;
  const parts = new Map(entries.flatMap((e) => (e.kind === 'text' ? [[e.partId, e.data.text] as const] : [])));
  return {
    reply: [...parts.values()].join('\n'),
    tools: entries.flatMap((e) => (e.kind === 'tool_call' ? [e.data.tool] : [])),
    errors: entries.filter((e) => e.kind === 'error'),
  };
}

const prompt = (name: string) => readFile(new URL(`../packages/builtin/prompts/${name}.md`, import.meta.url), 'utf8');

it('@live 连续任务通知区分待验收、失败和 PR 创建，跳过检查不报通过且不自动操作', async () => {
  const conversation = (await t.call(createConversationOp, {})).body;
  const initial = idleOf(conversation.id);
  await t.call(sendAssistantMessageOp, {
    id: conversation.id,
    text: '接下来收到的任务状态通知，请用中文简短回报，明确哪些还需要我检查，不要自动操作。',
    context: { page: 'home', params: {} },
  });
  await initial;
  const template = await prompt('assistant-task-updated');
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
  for (const [index, snapshot] of snapshots.entries()) {
    const turn = await relay(
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
    reports.push({ snapshot, ...turn });
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

it('@live 知识问答、需求拆解与成员分析的结束通知：只按通知转述并给出链接，不调用工具', async () => {
  const conversation = (await t.call(createConversationOp, {})).body;
  const knowledge = renderTemplate(await prompt('assistant-knowledge-answered'), {
    conversationId: 'kc-fixture',
    question: '中位数是怎么算的？',
    answer: '先排序，奇数个取中间值，偶数个取中间两个值的平均 [1]。空数组会抛出错误 [2]。',
    citations: [
      '[1] src/stats.ts:12-20 — link: /knowledge/kc-fixture?turn=t1&cite=1',
      '[2] src/stats.ts:8-10 — link: /knowledge/kc-fixture?turn=t1&cite=2',
    ].join('\n'),
    pageLink: '/knowledge/kc-fixture',
    exampleLink: '/knowledge/kc-fixture?turn=t1&cite=1',
  });
  const breakdown = renderTemplate(await prompt('assistant-breakdown'), {
    snapshot: JSON.stringify({
      initiativeId: 'in-fixture',
      key: 'N-7',
      title: '待办应用二期',
      status: 'draft_ready',
      mode: 'breakdown',
      openPhase: null,
      run: { status: 'succeeded', error: null },
      link: '/initiatives/in-fixture',
      phases: [
        { title: '数据与接口', goal: '服务端存储与 REST 接口', items: [{ key: 'api', title: '待办 REST 接口' }] },
        { title: '页面', goal: '筛选与提醒', items: [{ key: 'filter', title: '搜索与筛选' }] },
      ],
      coverage: { points: 3, uncovered: ['统计页'] },
    }),
  });
  const analysis = renderTemplate(await prompt('assistant-team-analysis'), {
    snapshot: JSON.stringify({
      analysisId: 'ta-fixture',
      member: 'zs@corp.com',
      status: 'succeeded',
      error: null,
      link: '/team/p-fixture/members/zs%40corp.com',
      sample: [{ sha: 'abc1234', subject: 'fix: 日期边界', lines: 12 }],
      report: {
        summary: '主要修复订单日期相关的缺陷',
        workItems: [{ title: '日期边界修复', description: '修正跨月计算' }],
        strengths: ['改动附带测试'],
        concerns: ['一处错误被吞掉'],
        findings: [{ severity: 'minor', category: 'error_handling', title: '吞掉异常', where: 'abc1234 src/a.ts:3' }],
      },
    }),
  });
  // The conversation holds only these notifications. A reply's last streamed pieces may land after its turn goes idle,
  // so the whole conversation is read after one more turn, by which the third reply has been written in full.
  for (const message of [knowledge, breakdown, analysis]) await relay(conversation.id, message);
  const { reply, tools, errors } = await relay(conversation.id, '请用一句话确认你已经转述完上面三条通知。');
  const all = await t.request({ method: 'GET', url: `/assistant/conversations/${conversation.id}/transcript` });
  const entries = all.json<TranscriptPage>().entries;
  const text = replyOf(entries);
  await mkdir(new URL('reports/', import.meta.url), { recursive: true });
  await writeFile(
    new URL(`reports/assistant-relays-${new Date().toISOString().replaceAll(':', '-')}.json`, import.meta.url),
    JSON.stringify({ model: TEST_MODEL, text, last: { reply, tools, errors } }, null, 2),
  );
  expect(entries.filter((e) => e.kind === 'error')).toEqual([]);
  expect(entries.flatMap((e) => (e.kind === 'tool_call' ? [e.data.tool] : []))).toEqual([]);
  expect(text).toContain('/knowledge/kc-fixture');
  expect(text).toContain('/initiatives/in-fixture');
  expect(text).toContain('/team/p-fixture/members/');
});
