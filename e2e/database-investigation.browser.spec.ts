import { randomUUID } from 'node:crypto';
import {
  type DatabaseInvestigation,
  MCP_ASSISTANT_TOOL_PREFIX,
  MCP_TOOL_PREFIX,
  McpToolName,
  type TranscriptEntry,
  TranscriptEntryKind,
  taskDetailSchema,
} from '@aw/shared';
import { expect, type Page } from '@playwright/test';
import { test } from './assistant-fixtures.ts';
import { API_BASE, AUTH } from './env.ts';
import { createProject, patchSettings, queueAssistantTurn, queueTurn } from './helpers.ts';

const connection = '合成订单库';
const question = '统计订单状态';
const sql = 'SELECT status, COUNT(*) FROM orders GROUP BY status';

function timeline(attemptId?: string) {
  const ts = Date.now();
  const current: DatabaseInvestigation = {
    investigationId: randomUUID(),
    connection,
    question,
    status: 'running',
    answer: '',
    createdAt: ts,
    updatedAt: ts,
    ...(attemptId === undefined ? {} : { attemptId }),
    evidence: [],
    turns: [],
    limitations: [],
  };
  return { ts, current };
}

function call(tool: string, ts: number): TranscriptEntry {
  return {
    kind: TranscriptEntryKind.ToolCall,
    seq: 2,
    ts,
    data: { callId: 'db-investigate-1', tool, input: { connection, question } },
  };
}

function result(tool: string, current: DatabaseInvestigation): TranscriptEntry {
  return {
    kind: TranscriptEntryKind.ToolResult,
    seq: 3,
    ts: current.updatedAt,
    data: { callId: 'db-investigate-1', tool, status: 'completed', output: JSON.stringify(current) },
  };
}

const lookupError = 'DB_CONNECTION_NOT_FOUND · This investigation requires the same linked database';
const legacyReceipt = 'Legacy investigation receipt';

function otherReceipts(tool: string, ts: number): TranscriptEntry[] {
  return [
    {
      kind: TranscriptEntryKind.ToolCall,
      seq: 4,
      ts,
      data: { callId: 'db-error', tool, input: { connection: '未绑定库', question } },
    },
    {
      kind: TranscriptEntryKind.ToolResult,
      seq: 5,
      ts,
      data: { callId: 'db-error', tool, status: 'error', error: lookupError },
    },
    {
      kind: TranscriptEntryKind.ToolCall,
      seq: 6,
      ts,
      data: { callId: 'db-legacy', tool, input: { connection: '旧运行库', question } },
    },
    {
      kind: TranscriptEntryKind.ToolResult,
      seq: 7,
      ts,
      data: { callId: 'db-legacy', tool, status: 'completed', output: legacyReceipt },
    },
  ];
}

const evidence: DatabaseInvestigation['evidence'][number] = {
  id: 'query-1',
  kind: 'query',
  sql,
  durationMs: 37,
  rowCount: 2,
  truncated: true,
  summary: '仅展示脱敏的状态汇总。',
};

async function expectEvidence(page: Page, id: string) {
  const region = page.getByRole('region', { name: '数据库调查证据' });
  await expect(region.getByText(id, { exact: true })).toBeVisible();
  await expect(region.getByText(sql, { exact: true })).toBeVisible();
  await expect(region.getByText('返回 2 行 · 37 毫秒')).toBeVisible();
  await expect(region.getByText('结果已截断')).toBeVisible();
  await expect(region.getByText(evidence.summary)).toBeVisible();
}

test('助手活动显示本轮调查进度，完成后打开历史查询证据', async ({ page, request }) => {
  await patchSettings(request, { 'ui.mode': 'simple' });
  await createProject(request, null);
  const response = await request.post(`${API_BASE}/assistant/conversations`, {
    headers: AUTH,
    data: { title: question },
  });
  await expect(response).toBeOK();
  const { id } = await response.json();
  try {
    await queueAssistantTurn(request, [{ type: 'hang' }]);
    await expect(
      await request.post(`${API_BASE}/assistant/conversations/${id}/messages`, {
        headers: AUTH,
        data: { text: question, context: { page: 'home', params: {} } },
      }),
    ).toBeOK();
    const { ts, current } = timeline();
    const tool = `${MCP_ASSISTANT_TOOL_PREFIX}${McpToolName.InvestigateDatabase}`;
    const message: TranscriptEntry = {
      seq: 1,
      ts: ts - 1,
      kind: TranscriptEntryKind.UserMessage,
      data: { text: question },
    };
    let completed = false;
    await page.route(`**/assistant/conversations/${id}/history`, (route) =>
      route.fulfill({
        json: {
          entries: [message, call(tool, ts), ...(completed ? [result(tool, current), ...otherReceipts(tool, ts)] : [])],
          before: null,
          lastSeq: completed ? 7 : 2,
        },
      }),
    );
    const previous = {
      ...current,
      investigationId: randomUUID(),
      createdAt: ts - 1000,
      updatedAt: ts - 100,
      answer: '旧轮次结论',
    };
    const concurrent = { ...current, investigationId: randomUUID(), answer: '无法区分的并发调用' };
    let ambiguous = false;
    await page.route(`**/database-investigations/assistant/${id}`, (route) =>
      route.fulfill({ json: { items: [previous, current, ...(ambiguous ? [concurrent] : [])] } }),
    );
    await page.goto(`/?conversation=${id}`);
    const assistantAction = page.getByTestId('assistant-action').filter({ hasText: '调查数据库' });
    const activity = assistantAction.filter({ hasText: connection });
    await activity.locator('summary').click();
    await expect(activity.getByText(current.investigationId, { exact: true })).toBeVisible();
    await expect(activity.getByText(previous.investigationId, { exact: true })).toHaveCount(0);
    current.evidence.push(evidence);
    await expectEvidence(page, current.investigationId);
    ambiguous = true;
    await expect(activity.getByRole('region', { name: '数据库调查证据' })).toHaveCount(0);
    await expect(activity.getByText('调查中', { exact: true })).toBeVisible();
    current.status = 'completed';
    current.answer = '已按记录状态归组。';
    current.limitations = ['源数据仅代表当前时点。'];
    completed = true;
    await page.unroute(`**/database-investigations/assistant/${id}`);
    await page.reload();
    await activity.locator('summary').click();
    await expectEvidence(page, current.investigationId);
    await expect(activity.getByText(current.answer, { exact: true })).toBeVisible();
    await expect(activity.getByText(current.limitations[0] ?? '')).toBeVisible();
    await assistantAction.filter({ hasText: '未绑定库' }).locator('summary').click();
    await expect(assistantAction.filter({ hasText: '未绑定库' }).getByText(lookupError)).toBeVisible();
    await assistantAction.filter({ hasText: '旧运行库' }).locator('summary').click();
    await expect(assistantAction.filter({ hasText: '旧运行库' }).getByText(legacyReceipt)).toBeVisible();
  } finally {
    await request.post(`${API_BASE}/assistant/conversations/${id}/abort`, { headers: AUTH, data: {} });
    await request.delete(`${API_BASE}/assistant/conversations/${id}`, { headers: AUTH });
  }
});

test('节点调查只显示本尝试的证据', async ({ page, request }) => {
  await patchSettings(request, { 'ui.mode': 'simple' });
  const project = await createProject(request, null);
  await queueTurn(request, project, { title: '定位根因' }, [{ type: 'hang' }]);
  const workflows = await (await request.get(`${API_BASE}/workflows`, { headers: AUTH })).json();
  const workflow = workflows.items.find(({ key }: { key: string }) => key === 'bugfix');
  const response = await request.post(`${API_BASE}/tasks`, {
    headers: AUTH,
    data: { projectId: project.id, workflowId: workflow.id, requirement: question },
  });
  await expect(response).toBeOK();
  const task = taskDetailSchema.parse(await response.json());
  try {
    const read = async () =>
      taskDetailSchema.parse(await (await request.get(`${API_BASE}/tasks/${task.id}`, { headers: AUTH })).json());
    await expect.poll(async () => (await read()).activeAttempts.length).toBe(1);
    const attempt = (await read()).activeAttempts[0];
    if (attempt?.nodeId == null) throw new Error('Task node attempt did not start');
    const { ts, current } = timeline(attempt.id);
    current.evidence.push(evidence);
    const otherAttempt = {
      ...current,
      investigationId: randomUUID(),
      attemptId: 'different-attempt',
      answer: '同名调查来自另一个尝试',
    };
    const tool = `${MCP_TOOL_PREFIX}${McpToolName.InvestigateDatabase}`;
    await page.route(`**/attempts/${attempt.id}/transcript?*`, (route) =>
      route.fulfill({
        json: { entries: [call(tool, ts), ...otherReceipts(tool, ts)], hasMore: false, done: false, lastSeq: 7 },
      }),
    );
    await page.route(`**/database-investigations/task/${task.id}`, (route) =>
      route.fulfill({ json: { items: [otherAttempt, current] } }),
    );
    await page.goto(`/tasks/${task.id}/nodes/${attempt.nodeId}?attempt=${attempt.id}`);
    const nodeAction = page.getByTestId('stream-action').filter({ hasText: '调查数据库' });
    await nodeAction.filter({ hasText: connection }).getByRole('button').click();
    await expectEvidence(page, current.investigationId);
    await expect(page.getByText(otherAttempt.answer)).toHaveCount(0);
    await nodeAction.filter({ hasText: '未绑定库' }).getByRole('button').click();
    await expect(nodeAction.filter({ hasText: '未绑定库' }).getByText(lookupError)).toBeVisible();
    await nodeAction.filter({ hasText: '旧运行库' }).getByRole('button').click();
    await expect(nodeAction.filter({ hasText: '旧运行库' }).getByText(legacyReceipt)).toBeVisible();
  } finally {
    await request.post(`${API_BASE}/tasks/${task.id}/cancel`, { headers: AUTH, data: {} });
  }
});
