import { expect } from '@playwright/test';
import { test } from './assistant-fixtures.ts';
import { appTool, createProject, patchSettings, queueAssistantTurn } from './helpers.ts';

const source = (name: string, body: string) => `---\nname: ${name}\ndescription: 汇报制作约定\n---\n\n${body}`;

test('新建和导入 Skill，绑定到流程，在助手里选用并保存提炼草稿', async ({ page, request }) => {
  await patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' });
  const project = await createProject(request, null);
  await page.goto('/settings');
  const library = page.locator('#my-skills');
  await library.getByRole('button', { name: '新建 Skill' }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('SKILL.md', { exact: true }).fill(source('weekly-report-e2e', '先展示已核验的数字。'));
  await editor.getByRole('button', { name: '保存 Skill' }).click();
  await expect(library.getByText('weekly-report-e2e', { exact: false })).toBeVisible();

  const file = page.waitForEvent('filechooser');
  await library.getByRole('button', { name: '导入 SKILL.md' }).click();
  await (await file).setFiles({
    name: 'SKILL.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(source('sheet-review-e2e', '检查表头和空行。')),
  });
  await expect(editor.getByLabel('SKILL.md', { exact: true })).toHaveValue(/sheet-review-e2e/);
  await editor.getByRole('button', { name: '保存 Skill' }).click();
  await expect(library.getByText('sheet-review-e2e', { exact: false })).toBeVisible();

  await page.goto(`/projects/${project.id}`);
  await page.getByLabel('流程', { exact: true }).selectOption('feature');
  await page.getByRole('checkbox', { name: /weekly-report-e2e/ }).check();
  await page.getByRole('button', { name: '保存绑定' }).click();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel('流程', { exact: true }).selectOption('feature');
  await expect(page.getByRole('checkbox', { name: /weekly-report-e2e/ })).toBeChecked();
  await page.goto(`/?projectId=${project.id}&workflow=feature`);
  await expect(page.getByText('weekly-report-e2e · v1', { exact: true })).toBeVisible();

  await queueAssistantTurn(request, [{ type: 'text', text: '已按约定整理。' }]);
  await page.goto('/');
  await page.getByRole('button', { name: '选择 Skill' }).click();
  await editor.getByRole('checkbox', { name: /sheet-review-e2e/ }).check();
  await editor.getByRole('button', { name: '完成' }).click();
  const input = page.getByLabel('告诉助手，或开始任务');
  await input.fill('整理这次表格检查的复盘');
  await input.press('ControlOrMeta+Enter');
  const messages = page.getByTestId('home-messages');
  await expect(messages).toContainText('sheet-review-e2e · v1');
  await expect(messages).toContainText('已按约定整理。');

  await queueAssistantTurn(request, [
    appTool('open_form', { form: 'skills.create', values: { source: source('draft-report-e2e', '先核对表头。') } }),
  ]);
  await page.getByRole('button', { name: '切换对话' }).click();
  await page.getByRole('menuitem', { name: '提炼为 Skill' }).click();
  await expect(editor.getByRole('heading', { name: '助手拟好的 Skill' })).toBeVisible();
  await editor.getByLabel('SKILL.md', { exact: true }).fill(source('draft-report-e2e', '检查表头后逐列核对数据类型。'));
  await editor.getByRole('button', { name: '保存 Skill' }).click();
  await expect(library.getByText('draft-report-e2e', { exact: false })).toBeVisible();
});
