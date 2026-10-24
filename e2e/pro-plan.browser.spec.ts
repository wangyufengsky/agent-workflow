import { expect, type Page, test } from '@playwright/test';
import {
  createProject,
  type E2EProject,
  passReview,
  patchSettings,
  pickWorkflow,
  queueTurn,
  submitResult,
  TASK_RUN_TIMEOUT_MS,
} from './helpers.ts';

// J7 and J23 (07 §5) and the step-operation smoke test of M5-03, in pro mode; AI sessions are played by FakeOpencode.

test.beforeEach(({ request }) => patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'pro' }));
test.afterAll(({ request }) => patchSettings(request, { 'ui.mode': 'simple' }));

/** A bug-fix task (template plan: 定位根因 → 修复), optionally waiting for the plan to be confirmed. */
async function startBugfix(page: Page, project: E2EProject, requirement: string, confirmPlan: boolean) {
  await page.goto(`/?projectId=${project.id}`);
  await pickWorkflow(page, /修 Bug/);
  await page.getByLabel('需求').fill(requirement);
  if (confirmPlan) await page.getByLabel('运行前让我确认计划').check();
  await page.getByRole('button', { name: /^开始/ }).click();
  // Starting creates the task's worktree first (up to 9 s on the Windows runner).
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+/, { timeout: TASK_RUN_TIMEOUT_MS });
}

test('J7 专业模式：开启确认计划 → 编辑计划（在连线上加步骤）→ 确认 → 按新计划执行', async ({ page, request }) => {
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
  await editor.getByRole('button', { name: '在「修复」和「结束」之间插入步骤' }).click();
  const form = editor.getByTestId('plan-node-form');
  await form.getByLabel('标题').fill('补充文档');
  // Without instructions the plan cannot be saved; the editor says why.
  await expect(editor.getByTestId('plan-problems')).toContainText('不能为空');
  await expect(editor.getByRole('button', { name: '保存修改' })).toBeDisabled();
  await form.getByLabel('指令').fill('在 CHANGELOG.md 写一行变更说明');
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

/** Whether the element lies wholly inside the canvas's visible area. */
async function insideCanvas(page: Page, testId: string): Promise<boolean> {
  const canvas = await page.getByRole('region', { name: '计划画布' }).boundingBox();
  const box = await page.getByTestId(testId).boundingBox();
  if (canvas === null || box === null) throw new Error(`no box for ${testId}`);
  return (
    box.x >= canvas.x &&
    box.y >= canvas.y &&
    box.x + box.width <= canvas.x + canvas.width &&
    box.y + box.height <= canvas.y + canvas.height
  );
}

test('J23 画布：在连线上插入步骤 → 滑出后适应画布 → 删除后前后自动相连 → 撤销 → 保存', async ({ page, request }) => {
  // View moves are instant, so where the view is can be checked right after each step.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const project = await createProject(request, null);
  await startBugfix(page, project, '导出的报表缺少最后一行', true);
  await page.getByRole('button', { name: '编辑计划' }).click();
  const editor = page.getByTestId('plan-editor');

  // The + between two steps inserts one there, already connected on both sides, and selects it.
  await editor.getByRole('button', { name: '在「定位根因」和「修复」之间插入步骤' }).click();
  await expect(editor.getByTestId('step-step_3')).toBeVisible();
  const form = editor.getByTestId('plan-node-form');
  await form.getByLabel('标题').fill('写复现测试');
  await expect(editor.getByRole('button', { name: '在「定位根因」和「写复现测试」之间插入步骤' })).toBeVisible();
  await expect(editor.getByRole('button', { name: '在「写复现测试」和「修复」之间插入步骤' })).toBeVisible();

  // Scrolled far away, the view stays there while the step is edited, and 适应画布 brings every step back.
  await page.getByRole('region', { name: '计划画布' }).hover();
  await page.mouse.wheel(2000, 0);
  await expect.poll(() => insideCanvas(page, 'step-step_3')).toBe(false);
  await form.getByLabel('指令').fill('写一个失败的测试复现缺少最后一行');
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
  expect(await insideCanvas(page, 'step-step_3')).toBe(false);
  await editor.getByRole('button', { name: '适应画布' }).click();
  for (const step of ['step-locate', 'step-step_3', 'step-fix']) {
    await expect.poll(() => insideCanvas(page, step)).toBe(true);
  }

  // − removes it and joins its neighbours again; undo brings it back.
  await editor.getByRole('button', { name: '删除「写复现测试」' }).click();
  await expect(editor.getByTestId('step-step_3')).toHaveCount(0);
  await expect(editor.getByRole('button', { name: '在「定位根因」和「修复」之间插入步骤' })).toBeVisible();
  await editor.getByRole('status').getByRole('button', { name: '撤销' }).click();
  await expect(editor.getByTestId('step-step_3')).toBeVisible();

  await editor.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByText('AI 的计划 · 第 2 版')).toBeVisible();
  await expect(page.getByTestId('plan-steps')).toContainText('写复现测试');
});
