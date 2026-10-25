import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject, type FakeStep, patchSettings, queueBreakdownTurn, TASK_RUN_TIMEOUT_MS } from './helpers.ts';

// Journey J38 (07 §5, 34 §5.1–§5.2, §8): the AI breaks a requirement down, the user asks for changes, then confirms.

test.beforeEach(({ request }) => patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' }));

const item = (key: string, title: string, phase: number, dependsOn: string[] = []) => ({
  key,
  title,
  phase,
  workflow: 'unit_tests',
  requirement: `为 ${key}/ 补单元测试`,
  depends_on: dependsOn,
});
const breakdown = (title: string, items: ReturnType<typeof item>[]): FakeStep => ({
  type: 'callTool',
  name: 'submit_breakdown',
  args: {
    title,
    summary: '先补订单，再补依赖它的支付。',
    understanding: {
      scope: '订单与支付模块的单元测试',
      assumptions: ['测试放在模块旁边'],
      risks: ['支付依赖外部网关'],
    },
    phases: [
      { title: '订单', goal: '订单有测试' },
      { title: '支付', goal: '支付有测试' },
    ],
    items,
    coverage: [
      { point: '订单模块有测试', items: ['order'] },
      { point: '支付模块有测试', items: ['payment'] },
      { point: '性能测试', items: [] },
    ],
  },
});

test('J38 主页「让 AI 拆解」→ 拆解草稿（理解与需求覆盖）→ 重拆失败仍是原草稿 → 按意见重新拆解 → 确认并开始第 1 阶段', async ({
  page,
  request,
}) => {
  const project = await createProject(request, null);
  await queueBreakdownTurn(request, project, [
    breakdown('订单与支付测试', [item('order', '订单测试', 1), item('payment', '支付测试', 2, ['order'])]),
  ]);

  await page.goto(`/?projectId=${project.id}`);
  await page.getByRole('button', { name: '直接开始', exact: true }).click();
  await page
    .getByRole('group', { name: '选择流程开始任务' })
    .getByRole('button', { name: '让 AI 拆解', exact: true })
    .click();
  await expect(page.getByRole('button', { name: /开始 · AI 拆解需求计划/ })).toBeVisible();
  await page.getByRole('textbox', { name: '需求', exact: true }).fill('给订单和支付补单元测试');
  await page.getByRole('button', { name: /^开始/ }).click();

  await expect(page.getByTestId('initiative-page')).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS });
  await expect(page.getByRole('heading', { name: /订单与支付测试/ })).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS });
  const understanding = page.getByTestId('initiative-understanding');
  await expect(understanding).toContainText('先补订单，再补依赖它的支付。');
  await understanding.getByText('需求 3 点，2 点有对应工作包').click();
  await expect(understanding).toContainText('性能测试');
  await expect(page.getByTestId('initiative-phase')).toHaveCount(2);

  // A re-breakdown that submits nothing fails: the draft stays as it was, and the page says so.
  await page.getByRole('button', { name: '按意见重新拆解' }).click();
  const failing = page.getByRole('dialog', { name: '让 AI 重新拆解？' });
  await failing.getByRole('button', { name: '按意见重新拆解' }).click();
  await expect(page.getByRole('alert')).toContainText('这次重新拆解没有交出新的草稿', { timeout: TASK_RUN_TIMEOUT_MS });
  await expect(page.getByTestId('initiative-item').nth(1)).toContainText('支付测试');

  // Feedback: the AI breaks it down again on the same session.
  await queueBreakdownTurn(request, project, [
    breakdown('订单与支付测试', [item('order', '订单测试', 1), item('payment', '支付测试（含退款）', 2, ['order'])]),
  ]);
  await page.getByRole('button', { name: '按意见重新拆解' }).click();
  const dialog = page.getByRole('dialog', { name: '让 AI 重新拆解？' });
  await dialog.getByLabel('意见（可选）').fill('支付要包括退款');
  await dialog.getByRole('button', { name: '按意见重新拆解' }).click();
  await expect(page.getByTestId('initiative-item').nth(1)).toContainText('支付测试（含退款）', {
    timeout: TASK_RUN_TIMEOUT_MS,
  });

  await page.getByRole('button', { name: '确认并开始第 1 阶段' }).click();
  await expect(page.getByTestId('initiative-item').first()).toContainText(/T-\d+/, { timeout: TASK_RUN_TIMEOUT_MS });
  await expect(page.getByTestId('initiative-item').nth(1)).toContainText('阶段未开始');
});

test('J41 专业模式：「让 AI 拆解」时选可选流程，默认是改动仓库的内置流程；全不选不能开始', async ({
  page,
  request,
}) => {
  await patchSettings(request, { 'ui.mode': 'pro' });
  const project = await createProject(request, null);
  await page.goto(`/?projectId=${project.id}`);
  await page.getByRole('button', { name: '直接开始', exact: true }).click();
  await page
    .getByRole('group', { name: '选择流程开始任务' })
    .getByRole('button', { name: '让 AI 拆解', exact: true })
    .click();
  await page.getByRole('textbox', { name: '需求', exact: true }).fill('给订单和支付补单元测试');

  await page.getByRole('button', { name: /可选流程/ }).click();
  // Exact names: other specs on the shared backend add custom workflows such as 「我的修 Bug」.
  const allowed = page.getByRole('group', { name: '可选流程' });
  await expect(allowed.getByLabel('新功能开发', { exact: true })).toBeChecked();
  await expect(allowed.getByLabel('详细设计', { exact: true })).toBeChecked();
  await expect(allowed.getByLabel('代码审查', { exact: true })).not.toBeChecked();
  for (const name of ['新功能开发', '修 Bug', '补单元测试', '重构', '清理告警', '详细设计', '需求拆解']) {
    await allowed.getByLabel(name, { exact: true }).uncheck();
  }
  await expect(page.getByText('至少选一个流程')).toBeVisible();
  await expect(page.getByRole('button', { name: /^开始/ })).toBeDisabled();
  await allowed.getByLabel('补单元测试', { exact: true }).check();
  await allowed.getByLabel('代码审查', { exact: true }).check();
  await page.getByRole('button', { name: /^开始/ }).click();

  await expect(page.getByTestId('initiative-page')).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS });
  const id = new URL(page.url()).pathname.split('/').at(-1);
  const initiative = await (await request.get(`${API_BASE}/initiatives/${id}`, { headers: AUTH })).json();
  expect(initiative.allowedWorkflows).toEqual(['unit_tests', 'code_review']);
  await patchSettings(request, { 'ui.mode': 'simple' });
});
