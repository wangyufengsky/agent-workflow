import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject, patchSettings } from './helpers.ts';

// Journey J40 (07 §5, 34 §15.6): custom composition templates in pro mode — saved from an initiative, copied from a
// built-in one, deleted, and offered on the home page under「自定义」.

test.beforeEach(({ request }) => patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'pro' }));
test.afterAll(({ request }) => patchSettings(request, { 'ui.mode': 'simple' }));

test('J40 专业模式：需求计划「存为模板」（先改出 {{requirement}}）→ 复制内置模板 → 删除 → 主页「自定义」里有它', async ({
  page,
  request,
}) => {
  const project = await createProject(request, null);
  // A template with「先让我看看」: the draft waits and nothing runs.
  const created = await request.post(`${API_BASE}/initiatives`, {
    headers: AUTH,
    data: { projectId: project.id, templateKey: 'tests_then_refactor', review: true, requirement: '订单金额计算' },
  });
  const initiative = await created.json();
  // The initiative's own check, specific to it: the template editor shows it so that it can go.
  await request.put(`${API_BASE}/initiatives/${initiative.id}/draft`, {
    headers: AUTH,
    data: {
      phases: initiative.phases,
      items: initiative.items.map(
        (i: {
          key: string;
          title: string;
          phase: number;
          workflow: string;
          requirement: string;
          dependsOn: string[];
        }) => ({
          key: i.key,
          title: i.title,
          phase: i.phase,
          workflow: i.workflow,
          requirement: i.requirement,
          dependsOn: i.dependsOn,
          acceptance:
            i.key === 'tests'
              ? [
                  {
                    title: '订单金额有测试',
                    expected: '四舍五入的边界都覆盖',
                    verification: { kind: 'command', command: 'pnpm test orders' },
                  },
                ]
              : [],
        }),
      ),
    },
  });

  await page.goto(`/initiatives/${initiative.id}`);
  await page.getByRole('link', { name: '存为模板' }).click();
  const editor = page.getByTestId('template-editor');
  await expect(page.getByText(`来自需求计划 ${initiative.key}`)).toBeVisible();
  // The requirements hold the initiative's own text: no {{requirement}} yet.
  await expect(page.getByTestId('template-problems')).toContainText('没有一个工作包的需求含 {{requirement}}');
  await expect(editor.getByRole('button', { name: '保存' })).toBeDisabled();
  await editor.getByLabel('补单元测试 · 需求').fill('为 {{requirement}} 补单元测试，固定现有行为');
  const tests = editor.getByRole('group', { name: '补单元测试' });
  await expect(tests.getByLabel('要求 1')).toHaveValue('订单金额有测试');
  await tests.getByRole('button', { name: '删除第 1 项' }).click();
  await expect(tests.getByLabel('要求 1')).toHaveCount(0);
  await editor.getByLabel('标识', { exact: true }).fill('tests_refactor_mine');
  await editor.getByLabel('名称', { exact: true }).fill('我的补测试再重构');
  await editor.getByLabel('说明', { exact: true }).fill('团队的重构套路');
  await expect(page.getByText('可以保存。')).toBeVisible();
  await editor.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('组合模板已保存')).toBeVisible();
  await expect(page).toHaveURL(/\/initiative-templates$/);
  const saved = await (await request.get(`${API_BASE}/initiative-templates`, { headers: AUTH })).json();
  const template = saved.items.find((t: { key: string }) => t.key === 'tests_refactor_mine');
  expect(template.items.map((i: { acceptance: unknown[] }) => i.acceptance)).toEqual([[], []]);
  const mine = page.getByRole('article', { name: '我的补测试再重构' });
  await expect(mine).toContainText('自定义');
  await expect(mine).toContainText('补单元测试 → 重构');
  await mine.getByRole('link', { name: '编辑' }).click();
  await expect(page).toHaveURL(/\/initiative-templates\/tests_refactor_mine\/edit$/);
  await expect(editor.getByLabel('名称', { exact: true })).toHaveValue('我的补测试再重构');
  await page.getByRole('link', { name: '← 组合模板' }).click();

  await page.getByRole('article', { name: '设计后开发', exact: true }).getByRole('link', { name: '复制' }).click();
  await expect(editor.getByLabel('名称', { exact: true })).toHaveValue('设计后开发（副本）');
  await editor.getByLabel('标识', { exact: true }).fill('my_design');
  await editor.getByRole('button', { name: '保存' }).click();
  const copy = page.getByRole('article', { name: '设计后开发（副本）' });
  await expect(copy).toContainText('自定义');
  await copy.getByRole('button', { name: '删除' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除' }).click();
  await expect(page.getByText('组合模板已删除')).toBeVisible();
  await expect(copy).toHaveCount(0);

  await page.goto(`/?projectId=${project.id}`);
  await page.getByRole('button', { name: '直接开始', exact: true }).click();
  const panel = page.getByRole('group', { name: '选择流程开始任务' });
  await expect(panel.getByText('自定义', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '我的补测试再重构', exact: true }).click();
  await expect(page.getByRole('button', { name: /开始 · 我的补测试再重构/ })).toBeVisible();
});
