import { expect, test } from '@playwright/test';
import { createProject, patchSettings } from './helpers.ts';

// What simple mode shows (38, D158): five sidebar items, five workflow chips under「直接开始」with the others under
//「更多流程」, no theme switch in the header.

test('简单模式：侧栏 5 项、顶栏没有主题切换；「直接开始」5 个流程，其余在「更多流程」里', async ({ page, request }) => {
  await patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' });
  await createProject(request, null);
  await page.goto('/');

  const nav = page.getByRole('navigation', { name: 'Agent Workflow' });
  // Besides the items: the「开始任务」button above them and the runtime chip below;「任务」may carry the inbox count.
  await expect(nav.getByRole('link')).toHaveText([
    '开始任务',
    '主页',
    /^任务\d*$/,
    '项目',
    '知识问答',
    '设置',
    /opencode/,
  ]);
  await expect(page.getByRole('combobox', { name: '切换主题' })).toHaveCount(0);

  await page.getByRole('button', { name: '直接开始', exact: true }).click();
  const panel = page.getByRole('group', { name: '选择流程开始任务' });
  for (const name of ['新功能开发', '修 Bug', '补单元测试', '代码审查', '重构']) {
    await expect(panel.getByRole('button', { name, exact: true })).toBeVisible();
  }
  const more = page.getByRole('list', { name: '更多流程' });
  await expect(more).toBeHidden();
  await panel.getByRole('button', { name: /^更多流程/ }).click();
  await expect(more.getByRole('button')).toHaveCount(6);
  await more.getByRole('button', { name: /安全审查/ }).click();
  await expect(page.getByText('开始任务 · 安全审查')).toBeVisible();

  // Pro mode lists the moved pages in its own group.
  await patchSettings(request, { 'ui.mode': 'pro' });
  await page.reload();
  for (const name of ['PPT', '质量与用量', '团队']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await patchSettings(request, { 'ui.mode': 'simple' });
});
