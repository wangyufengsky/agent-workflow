import { expect, test } from '@playwright/test';
import {
  createProject,
  passReview,
  patchSettings,
  pickWorkflow,
  queueTurn,
  submitResult,
  TASK_RUN_TIMEOUT_MS,
} from './helpers.ts';

// The acceptance checklist (31, Q-03): written when starting the task, verified by the last step, decided on the
// result card. The file name sorts after onboarding.browser.spec.ts, which needs the shared backend without projects.

test.beforeEach(({ request }) => patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' }));

test('验收清单：开始任务时填写 → 核验步骤逐项给结论 → 未满足的必需项挡住交付 → 人工确认后合并', async ({
  page,
  request,
}) => {
  const project = await createProject(request, null);
  await queueTurn(request, project, { title: '定位根因' }, [submitResult('找到了原因')]);
  await queueTurn(request, project, { title: '修复' }, [
    { type: 'edit', file: 'search.ts', content: 'export const search = () => [];\n' },
    submitResult('修好了'),
  ]);
  await queueTurn(request, project, { agent: 'aw-reviewer', title: '修复' }, [passReview]);
  // The verify step gives no AI conclusion here: the AI item stays unverified.
  await queueTurn(request, project, { title: '核验验收清单' }, [submitResult('核验完成')]);

  await page.goto(`/?projectId=${project.id}`);
  await pickWorkflow(page, /修 Bug/);
  await page.getByLabel('需求').fill('订单搜索不到');
  await page.getByRole('button', { name: '验收要求' }).click();
  await page.getByLabel('要求 1').fill('按订单号搜索');
  await page.getByLabel('预期结果 1').fill('只显示匹配订单');
  await page.getByRole('button', { name: '添加一项' }).click();
  await page.getByLabel('要求 2').fill('单元测试通过');
  await page.getByLabel('预期结果 2').fill('退出码 0');
  await page.getByLabel('核验方式 2').selectOption('command');
  const start = page.getByRole('button', { name: /^开始/ });
  await expect(start).toBeDisabled();
  await page.getByLabel('命令 2').fill('false');
  await start.click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+/, { timeout: TASK_RUN_TIMEOUT_MS });

  const checklist = page.getByTestId('requirements');
  await expect(checklist).toContainText('2 项必需：0 项满足，2 项未满足', { timeout: TASK_RUN_TIMEOUT_MS });
  await expect(checklist).toContainText('未通过');
  await expect(checklist).toContainText('未核验');

  // Unmet required items hold delivery back until the user accepts them.
  const notice = page.getByTestId('unmet-requirements');
  await expect(notice).toContainText('有 2 项必需的验收要求未满足');
  const merge = page.getByRole('button', { name: /^合并到 main/ });
  await expect(merge).toBeDisabled();
  await notice.getByLabel('我知道这些项未满足，仍然交付').check();
  await expect(merge).toBeEnabled();
  // The acceptance is for that version: once the checklist is saved again, it has to be accepted again.
  await checklist.getByRole('button', { name: '编辑清单' }).click();
  const edit = page.getByRole('dialog', { name: '编辑验收清单' });
  await edit.getByLabel('预期结果 1').fill('只显示匹配订单，忽略大小写');
  await edit.getByRole('button', { name: '保存' }).click();
  await expect(edit).toBeHidden();
  await expect(notice.getByLabel('我知道这些项未满足，仍然交付')).not.toBeChecked();
  await expect(merge).toBeDisabled();

  // The user passes the AI item and accepts the failing command as not done, with a reason.
  await checklist
    .locator('details', { hasText: '按订单号搜索' })
    .getByRole('button', { name: '通过', exact: true })
    .click();
  await page.getByRole('dialog').getByLabel('说明').fill('亲自搜了一单');
  await page.getByRole('dialog').getByRole('button', { name: '通过', exact: true }).click();
  await checklist.locator('details', { hasText: '单元测试通过' }).getByRole('button', { name: '接受未完成' }).click();
  const waive = page.getByRole('dialog');
  await expect(waive.getByRole('button', { name: '接受未完成' })).toBeDisabled();
  await waive.getByLabel('原因（必填）').fill('测试环境暂时没有数据库');
  await waive.getByRole('button', { name: '接受未完成' }).click();

  await expect(checklist).toContainText('2 项必需：全部满足');
  await expect(notice).toBeHidden();
  await merge.click();
  await expect(page.getByTestId('task-page').getByText('已完成', { exact: true }).first()).toBeVisible({
    timeout: TASK_RUN_TIMEOUT_MS,
  });
});

test('「直接开始」默认收起：展开后 Esc 收起并还焦点，开始任务模式下从标签换流程（36 §5）', async ({
  page,
  request,
}) => {
  const project = await createProject(request, null);
  await page.goto(`/?projectId=${project.id}`);
  const toggle = page.getByRole('button', { name: '直接开始', exact: true });
  const flows = page.getByRole('group', { name: '选择流程开始任务' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(flows).toBeHidden();

  await toggle.press('Enter');
  await expect(flows).toBeVisible();
  // The panel comes before the foot, so opening moves focus into it.
  await expect(flows.getByRole('button', { name: '新功能开发', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(flows).toBeHidden();
  await expect(toggle).toBeFocused();

  await pickWorkflow(page, '修 Bug');
  await expect(flows).toBeHidden();
  await expect(page.getByLabel('需求')).toBeFocused();
  await page.getByRole('button', { name: '换一个流程 · 开始任务 · 修 Bug' }).click();
  await expect(flows.getByRole('button', { name: '修 Bug', exact: true })).toBeFocused();
  await flows.getByRole('button', { name: '代码审查', exact: true }).click();
  await expect(page.getByText('开始任务 · 代码审查')).toBeVisible();
});
