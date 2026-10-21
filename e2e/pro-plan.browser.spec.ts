import { expect, type Page, test } from '@playwright/test';
import {
  createProject,
  type E2EProject,
  passReview,
  patchSettings,
  queueTurn,
  submitResult,
  TASK_RUN_TIMEOUT_MS,
} from './helpers.ts';

// J7 (07 §5) and the step-operation smoke test of M5-03, in pro mode; AI sessions are played by FakeOpencode.

test.beforeEach(({ request }) => patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'pro' }));
test.afterAll(({ request }) => patchSettings(request, { 'ui.mode': 'simple' }));

/** A bug-fix task (template plan: 定位根因 → 修复), optionally waiting for the plan to be confirmed. */
async function startBugfix(page: Page, project: E2EProject, requirement: string, confirmPlan: boolean) {
  await page.goto(`/?projectId=${project.id}`);
  await page
    .getByRole('group', { name: '流程' })
    .getByRole('button', { name: /修 Bug/ })
    .click();
  await page.getByLabel('需求').fill(requirement);
  if (confirmPlan) await page.getByLabel('运行前让我确认计划').check();
  await page.getByRole('button', { name: /^开始/ }).click();
  // Starting creates the task's worktree first (up to 9 s on the Windows runner).
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+/, { timeout: TASK_RUN_TIMEOUT_MS });
}

test('J7 专业模式：开启确认计划 → 编辑计划（加节点、连线）→ 确认 → 按新计划执行', async ({ page, request }) => {
  const project = await createProject(request, null);
  await queueTurn(request, project, { title: '定位根因' }, [submitResult('找到了根因')]);
  await queueTurn(request, project, { title: '修复' }, [submitResult('修复了根因')]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);
  await queueTurn(request, project, { title: '补充文档' }, [
    { type: 'edit', file: 'CHANGELOG.md', content: '修复订单时间\n' },
    submitResult('补充了变更说明'),
  ]);

  await startBugfix(page, project, '订单时间显示错了', true);
  await page.getByRole('button', { name: '编辑计划' }).click();
  const editor = page.getByTestId('plan-editor');
  await editor.getByRole('button', { name: '添加步骤' }).click();
  const form = editor.getByTestId('plan-node-form');
  await form.getByLabel('标题').fill('补充文档');
  // Without instructions the plan cannot be saved; the editor says why.
  await expect(editor.getByTestId('plan-problems')).toContainText('不能为空');
  await expect(editor.getByRole('button', { name: '保存修改' })).toBeDisabled();
  await form.getByLabel('指令').fill('在 CHANGELOG.md 写一行变更说明');
  await form.getByRole('group', { name: '依赖的步骤' }).getByLabel('修复').check();
  await expect(editor.getByText('计划可以保存。')).toBeVisible();
  await expect(editor.getByTestId('step-step_3')).toBeVisible();
  await editor.getByRole('button', { name: '保存修改' }).click();

  await expect(page.getByText('AI 的计划 · 第 2 版')).toBeVisible();
  await page.getByRole('button', { name: '确认并开始' }).click();
  const result = page.getByTestId('result-card');
  await expect(result).toContainText('已完成 3 个步骤', { timeout: TASK_RUN_TIMEOUT_MS });
  await expect(result).toContainText('CHANGELOG.md');
});

test('步骤操作冒烟：暂停 → 跳过步骤 → 中止会话 → 继续执行', async ({ page, request }) => {
  const project = await createProject(request, null);
  await queueTurn(request, project, { title: '定位根因' }, [{ type: 'hang' }]);

  await startBugfix(page, project, '退款金额算错了', false);
  await expect(page.getByTestId('step-locate')).toContainText('进行中');
  await page.getByRole('button', { name: '暂停' }).click();
  await expect(page.getByTestId('paused-banner')).toBeVisible();

  await page.getByTestId('step-fix').click();
  await page.getByRole('button', { name: '跳过' }).click();
  await expect(page.getByTestId('step-fix')).toContainText('已跳过');

  await page.getByTestId('step-locate').click();
  await page.getByRole('button', { name: '中止' }).click();
  await expect(page.getByTestId('step-locate')).toContainText('即将开始');

  await queueTurn(request, project, { title: '定位根因' }, [submitResult('重新定位到了根因')]);
  await page.getByRole('button', { name: '继续执行' }).click();
  await expect(page.getByTestId('result-card')).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS });
});
