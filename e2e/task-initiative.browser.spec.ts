import { expect, test } from '@playwright/test';
import {
  createProject,
  GIT_HEAVY_SPECS_SLOW,
  patchSettings,
  queueTurn,
  submitResult,
  TASK_RUN_TIMEOUT_MS,
} from './helpers.ts';

// Journey J37 (07 §5, 34 §15): a composition template from the home panel, its report finished, the next phase on.

test.slow(GIT_HEAVY_SPECS_SLOW, 'two task runs (17 §4.1)');

test.beforeEach(({ request }) => patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' }));

test('J37 主页「直接开始」→「组合」的设计后开发 → 方案报告完成 → 第 2 阶段自动开始开发任务', async ({
  page,
  request,
}) => {
  const project = await createProject(request, null);
  await queueTurn(request, project, { title: '方案设计' }, [
    submitResult('推荐方案 B：在 Inventory 上加 byCategory()'),
  ]);

  await page.goto(`/?projectId=${project.id}`);
  await page.getByRole('button', { name: '直接开始', exact: true }).click();
  const panel = page.getByRole('group', { name: '选择流程开始任务' });
  await expect(panel.getByText('组合', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '设计后开发', exact: true }).click();
  await expect(page.getByRole('button', { name: /开始 · 设计后开发/ })).toBeVisible();
  await expect(page.getByText('方案设计 → 新功能开发', { exact: false })).toBeVisible();
  await page.getByLabel('需求').fill('按商品类别统计库存总量');
  await page.getByRole('button', { name: /^开始/ }).click();

  await expect(page.getByTestId('initiative-page')).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS });
  await expect(page.getByRole('heading', { name: /按商品类别统计库存总量/ })).toBeVisible();
  const phases = page.getByTestId('initiative-phase');
  await expect(phases).toHaveCount(2);
  await expect(phases.nth(1)).toContainText('前面完成后自动开始');
  // The design report waits for「完成」: the gate before the next phase (D147).
  const finish = page.getByRole('button', { name: '合并本阶段待合并的（1）' });
  await expect(finish).toBeVisible({ timeout: 2 * TASK_RUN_TIMEOUT_MS });
  await finish.click();
  const dialog = page.getByRole('dialog', { name: '把这 1 个工作包合并到 main？' });
  await dialog.getByRole('button', { name: '合并本阶段待合并的（1）' }).click();
  await expect(page.getByRole('status')).toContainText('已合并 1 个');

  const items = page.getByTestId('initiative-item');
  await expect(items.first()).toContainText('已完成');
  await expect(items.nth(1)).toContainText('T-2', { timeout: TASK_RUN_TIMEOUT_MS });
  await expect(phases.nth(1)).not.toContainText('前面完成后自动开始');
});
