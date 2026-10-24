import { expect } from '@playwright/test';
import { test } from './assistant-fixtures.ts';
import { appTool, createProject, patchSettings, queueAssistantTurn } from './helpers.ts';

// The assistant's charts (35, V-04): drawn from the `chart` entries of the message stream, kept across a reload.
// The file name sorts after onboarding.browser.spec.ts, which needs the shared backend without any project.

const PIE = {
  type: 'pie',
  title: '本周任务状态',
  categories: ['已完成', '待合并', '失败'],
  series: [{ name: '任务数', values: [7, 2, 1] }],
  unit: '个',
  caption: '本周开始的 10 个任务',
};
const FLOW = {
  title: '修 Bug 流程',
  nodes: [
    { id: 'start', label: '开始', shape: 'terminal' },
    { id: 'fix', label: '修复' },
    { id: 'test', label: '测试通过吗？', shape: 'decision' },
    { id: 'done', label: '待合并', shape: 'terminal' },
  ],
  edges: [
    { from: 'start', to: 'fix' },
    { from: 'fix', to: 'test' },
    { from: 'test', to: 'done', label: '通过' },
    { from: 'test', to: 'fix', label: '失败' },
  ],
};

test.beforeEach(({ request }) => patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' }));

test('助手画饼图与流程图：读数与读屏数据，刷新后仍在；简单模式只显示失败的画图动作', async ({ page, request }) => {
  const project = await createProject(request, null);
  await queueAssistantTurn(request, [
    // A pie with two series is refused; the model corrects it.
    appTool('show_chart', { ...PIE, series: [...PIE.series, { name: '上周', values: [1, 1, 1] }] }),
    appTool('show_chart', PIE),
    appTool('show_flowchart', FLOW),
    { type: 'text', text: '本周 10 个任务里 7 个已完成。' },
  ]);

  await page.goto(`/?projectId=${project.id}`);
  const input = page.getByRole('textbox', { name: '告诉助手，或开始任务' });
  await input.fill('按状态统计本周的任务，画个饼图；再画一下修 Bug 的流程');
  await input.press('ControlOrMeta+Enter');
  await expect(page).toHaveURL(/[?&]conversation=/);
  const stream = page.getByTestId('home-messages');
  await expect(stream).toContainText('本周 10 个任务里 7 个已完成。');

  const pie = stream.getByRole('figure', { name: '本周任务状态' });
  await expect(pie).toBeVisible();
  await expect(stream.getByTestId('assistant-chart').first()).toContainText('本周开始的 10 个任务');
  const done = pie.getByRole('button', { name: '已完成 · 7个 · 70%' });
  await done.focus();
  await expect(pie.locator('figcaption')).toHaveText('已完成 · 7个 · 70%');
  await expect(pie.getByRole('table', { name: '图表数据' })).toContainText('失败1个10%');

  const flow = stream.getByRole('figure', { name: '修 Bug 流程' });
  await expect(flow.getByText('测试通过吗？', { exact: true }).first()).toBeVisible();
  await expect(flow.getByRole('listitem').filter({ hasText: '判断：测试通过吗？' })).toHaveCount(1);
  await expect(flow.getByRole('listitem').filter({ hasText: '测试通过吗？ → 修复（失败）' })).toHaveCount(1);

  // The chart stands for its call; only the refused one keeps its row.
  const actions = stream.getByTestId('assistant-action');
  await expect(actions.filter({ hasText: '画图' })).toHaveCount(1);
  await expect(actions.filter({ hasText: '画流程图' })).toHaveCount(0);

  await page.reload();
  await expect(stream.getByTestId('assistant-chart')).toHaveCount(2);
  await expect(stream.getByRole('figure', { name: '本周任务状态' })).toBeVisible();

  await patchSettings(request, { 'ui.mode': 'pro' });
  await page.reload();
  await expect(actions.filter({ hasText: '画图' })).toHaveCount(2);
  await expect(actions.filter({ hasText: '画流程图' })).toHaveCount(1);
  await expect(stream.getByTestId('assistant-chart')).toHaveCount(2);
});
