import { expect, test } from '@playwright/test';
import { createProject, passReview, patchSettings, queueTurn, submitResult, TASK_RUN_TIMEOUT_MS } from './helpers.ts';

// J8 (07 §5): a copied built-in workflow, changed and used for a task; AI sessions are played by FakeOpencode.

test.beforeEach(({ request }) => patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'pro' }));
test.afterAll(({ request }) => patchSettings(request, { 'ui.mode': 'simple' }));

test('J8 专业模式：复制内置流程 → 修改 → 用它跑通一个任务', async ({ page, request }) => {
  const project = await createProject(request, null);
  await queueTurn(request, project, { title: '定位根因' }, [submitResult('找到了根因')]);
  await queueTurn(request, project, { title: '修复根因' }, [
    { type: 'edit', file: 'fix.txt', content: 'fixed\n' },
    submitResult('修复了根因'),
  ]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);

  await page.goto('/workflows');
  await page.getByRole('article', { name: '修 Bug' }).getByRole('button', { name: '复制' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('标识').fill('my_bugfix');
  await dialog.getByLabel('名称').fill('我的修 Bug');
  await dialog.getByRole('button', { name: '确定' }).click();
  await expect(page).toHaveURL(/\/workflows\/my_bugfix$/);

  const editor = page.getByTestId('plan-editor');
  await editor.getByLabel('步骤', { exact: true }).selectOption({ label: '修复（fix）' });
  await editor.getByTestId('plan-node-form').getByLabel('标题').fill('修复根因');
  await page.getByRole('button', { name: '保存为新版本' }).click();
  await expect(page.getByText('已保存为第 2 版')).toBeVisible();

  await page.goto(`/?projectId=${project.id}`);
  await page
    .getByRole('group', { name: '流程' })
    .getByRole('button', { name: /我的修 Bug/ })
    .click();
  await page.getByLabel('需求').fill('订单金额四舍五入错误');
  await page.getByRole('button', { name: /^开始/ }).click();
  const result = page.getByTestId('result-card');
  await expect(result).toContainText('已完成 2 个步骤', { timeout: TASK_RUN_TIMEOUT_MS });
  await expect(result).toContainText('fix.txt');
  await expect(page.getByTestId('task-page')).toContainText('我的修 Bug');
});

test('简单模式直接打开专业页面：说明属于专业模式，可一键开启', async ({ page, request }) => {
  await patchSettings(request, { 'ui.mode': 'simple' });
  await page.goto('/workflows');
  await expect(page.getByText('此页面属于专业模式')).toBeVisible();
  await page.getByRole('button', { name: '开启专业模式' }).click();
  // The shell header shows the same title once pro mode is on: the page's own heading is the one asserted.
  await expect(page.getByRole('main').getByRole('heading', { name: '流程' })).toBeVisible();
});
