import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import {
  box,
  createProject,
  MIN_WINDOW,
  passReview,
  patchSettings,
  pickWorkflow,
  queueTurn,
  submitResult,
  TASK_RUN_TIMEOUT_MS,
} from './helpers.ts';

// J8 (07 §5): a copied built-in workflow, changed and used for a task; AI sessions are played by FakeOpencode.

test.beforeEach(({ request }) => patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'pro' }));
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
  await editor.getByTestId('step-fix').click();
  const form = editor.getByTestId('plan-node-form');
  await form.getByLabel('标题').fill('修复根因');
  // Editing one check keeps the others, the page check included (29 §7.1).
  await expect(form.getByLabel('页面体检')).toBeChecked();
  await form.getByLabel('评审重点（可选）').fill('是否修复了根因');
  // Undone page paths leave the field too, so editing it again does not bring them back.
  const paths = form.getByLabel('页面路径（可选，空格分隔）');
  await paths.fill('/orders');
  await editor.getByRole('button', { name: '撤销' }).first().click();
  await expect(paths).toHaveValue('');
  await page.getByRole('button', { name: '保存为新版本' }).click();
  await expect(page.getByText('已保存为第 2 版')).toBeVisible();
  const get = async (path: string) => (await request.get(`${API_BASE}${path}`, { headers: AUTH })).json();
  const latest = (await get('/workflows/by-key/my_bugfix/versions')).items[0];
  const fix = (await get(`/workflows/${latest.id}`)).definition.template.nodes.find(
    (n: { key: string }) => n.key === 'fix',
  );
  expect(fix.acceptance.checks.map((c: { kind: string }) => c.kind)).toEqual(['command', 'browser', 'ai_review']);

  // A copied fixed workflow has the most actions (edit, copy, batch, schedule, delete): all stay in its card.
  const initial = page.viewportSize() ?? MIN_WINDOW;
  await page.setViewportSize(MIN_WINDOW);
  await page.goto('/workflows');
  const card = page.getByRole('article', { name: '我的修 Bug' });
  const edge = await box(card);
  for (const action of await card.locator('a, button').all()) {
    const drawn = await box(action);
    expect(drawn.right).toBeLessThanOrEqual(edge.right);
    expect(drawn.left).toBeGreaterThanOrEqual(edge.left);
  }
  await page.setViewportSize(initial);

  await page.goto(`/?projectId=${project.id}`);
  await pickWorkflow(page, /我的修 Bug/);
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
