import type { InsightsSummaryDTO } from '@aw/shared';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject, type E2EProject, passReview, patchSettings, queueTurn, submitResult } from './helpers.ts';

// Journey J16 (07 §5): quality and usage after tasks played by FakeOpencode. The backend is shared with the other
// specs, so the figures are compared with what the API reports before and after, and the page with the API.
// Specs run in file order on that backend and onboarding expects no project yet: this file sorts after it.

async function api<T>(request: APIRequestContext, method: 'GET' | 'POST', path: string, data?: object): Promise<T> {
  const res = await request.fetch(`${API_BASE}${path}`, { method, headers: AUTH, ...(data && { data }) });
  if (!res.ok()) throw new Error(`${method} ${path} failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

const week = (request: APIRequestContext) => api<InsightsSummaryDTO>(request, 'GET', '/insights?period=week');
const cost = (usd: number) => `$${usd.toFixed(4)}`;

/** A bug-fix task through to its merge; the turns were queued before. */
async function runAndMerge(request: APIRequestContext, project: E2EProject, requirement: string) {
  const workflows = await api<{ items: { id: string; key: string }[] }>(request, 'GET', '/workflows');
  const bugfix = workflows.items.find((w) => w.key === 'bugfix');
  if (bugfix === undefined) throw new Error('no bugfix workflow');
  const task = await api<{ id: string; key: string }>(request, 'POST', '/tasks', {
    projectId: project.id,
    workflowId: bugfix.id,
    requirement,
    start: true,
  });
  await expect
    .poll(async () => (await api<{ status: string }>(request, 'GET', `/tasks/${task.id}`)).status)
    .toBe('review');
  await api(request, 'POST', `/tasks/${task.id}/deliver`, { strategy: 'squash' });
  return task;
}

test('J16 质量与用量：简单视图本周三个数，专业视图用量与质量，钻取失败原因到任务页，四主题切换', async ({
  page,
  request,
}) => {
  await patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'simple' });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The check passes once the step changed something: a fix that submits nothing fails it.
  const project = await createProject(request, 'git status --porcelain | grep -q .');
  const before = await week(request);

  // First pass, every turn priced.
  await queueTurn(request, project, { title: '定位根因' }, [
    { type: 'usage', input: 1000, output: 100, cost: 0.5 },
    submitResult('找到了'),
  ]);
  await queueTurn(request, project, { title: '修复' }, [
    { type: 'usage', input: 2000, output: 200, cost: 1 },
    { type: 'edit', file: 'a.txt', content: 'a\n' },
    submitResult('改好了'),
  ]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [
    { type: 'usage', input: 500, output: 50, cost: 0.25 },
    passReview,
  ]);
  const clean = await runAndMerge(request, project, '一次通过');

  // The first fix changes nothing and fails the check; its turn and the locate step report no cost.
  await queueTurn(request, project, { title: '定位根因' }, [submitResult('找到了')]);
  await queueTurn(request, project, { title: '修复' }, [submitResult('没改')]);
  await queueTurn(request, project, { title: '修复' }, [
    { type: 'usage', input: 2000, output: 200, cost: 1 },
    { type: 'edit', file: 'b.txt', content: 'b\n' },
    submitResult('这次改了'),
  ]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);
  const retried = await runAndMerge(request, project, '重试后通过');

  const after = await week(request);
  expect(after.quality.ended.completed - before.quality.ended.completed).toBe(2);
  expect(after.usage.cost - before.usage.cost).toBeCloseTo(2.75);
  expect(after.usage.unpricedTokens - before.usage.unpricedTokens).toBe(3 * 120);
  expect(after.quality.retries - before.quality.retries).toBe(1);

  // Simple mode: this week's three figures, as the API counts them.
  await page.goto('/insights');
  const simple = page.getByTestId('insights-simple');
  await expect(simple).toContainText(`完成了 ${after.quality.ended.completed} 个任务`);
  await expect(simple).toContainText(`花了 ${cost(after.usage.cost)}`);
  await expect(simple).toContainText(`打扰了你 ${after.attention.interruptions} 次`);
  await expect(simple).toContainText(`tokens 未计价`);

  // Pro mode: usage and quality of the same week, then the tasks behind a failure reason.
  await page.getByRole('button', { name: '开启专业模式' }).click();
  await expect(page.getByRole('group', { name: '时间段' }).getByRole('button', { name: '本周' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('insights-usage')).toContainText(cost(after.usage.cost));
  await expect(page.getByTestId('insights-quality')).toContainText(`完成 ${after.quality.ended.completed}`);
  await page.getByRole('button', { name: '检查未通过' }).click();
  await expect(page.getByTestId('insights-drill')).toContainText('失败原因「检查未通过」');
  const table = page.getByTestId('insights-tasks');
  await expect(table.getByRole('link', { name: new RegExp(retried.key) })).toBeVisible();
  await expect(table.getByRole('link', { name: new RegExp(`${clean.key} `) })).toHaveCount(0);
  await table.getByRole('link', { name: new RegExp(retried.key) }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${retried.id}`));

  // Every theme renders the page; chart and bars take their colours from its tokens.
  for (const theme of ['deepseek', 'warm', 'spdb', 'github_white']) {
    await patchSettings(request, { 'ui.theme': theme });
    await page.goto('/insights?period=last_7_days');
    await expect(page.getByTestId('insights-usage')).toBeVisible();
    await expect(page.getByRole('figure')).toBeVisible();
  }
  expect(errors).toEqual([]);
  await patchSettings(request, { 'ui.mode': 'simple' });
});
