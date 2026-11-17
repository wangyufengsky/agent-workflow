import { expect } from '@playwright/test';
import { test } from './assistant-fixtures.ts';
import { appTool, createProject, patchSettings, queueAssistantTurn } from './helpers.ts';

const source = (name: string, body: string) => `---\nname: ${name}\ndescription: 汇报制作约定\n---\n\n${body}`;

test('新建和导入 Skill，绑定到流程，在助手里选用并保存提炼草稿', async ({ page, request }) => {
  await patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' });
  const project = await createProject(request, null);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '我的 Skill', exact: true })).toHaveCount(0);
  await page.getByRole('navigation').getByRole('link', { name: '我的 Skill', exact: true }).click();
  await expect(page).toHaveURL(/\/skills$/);
  const library = page.locator('#my-skills');
  await library.getByRole('button', { name: /^内置 \d+$/ }).click();
  await library.getByRole('searchbox', { name: '搜索 Skill' }).fill('aw-page-check');
  const details = library.getByRole('complementary', { name: 'Skill 详情' });
  await expect(details.getByText('开发工程师', { exact: true })).toBeVisible();
  await expect(details.getByText('测试工程师', { exact: true })).toBeVisible();
  await expect(details.getByText('评审员', { exact: true })).toBeVisible();
  await details.getByRole('tab', { name: 'SKILL.md' }).click();
  await expect(details.locator('pre')).toContainText('name: aw-page-check');
  await expect(details.getByRole('button', { name: '编辑正文' })).toHaveCount(0);

  const audience = library.getByRole('combobox', { name: '按使用对象筛选' });
  await library.getByRole('searchbox', { name: '搜索 Skill' }).fill('');
  await audience.selectOption({ label: 'Git 工作台代码审查' });
  await library.getByRole('button', { name: /^代码审查/ }).click();
  await expect(details.getByRole('heading', { name: '代码审查', exact: true })).toBeVisible();
  await expect(details.getByText('Git 工作台代码审查', { exact: true })).toBeVisible();
  await expect(details.getByText('评审员', { exact: true })).toBeVisible();
  await details.getByRole('tab', { name: 'SKILL.md' }).click();
  await expect(details.locator('pre')).toContainText('name: aw-code-review');
  await audience.selectOption({ label: '应用助手' });
  await expect(library.getByRole('button', { name: /任务验收与交付/ })).toBeVisible();
  await expect(library.getByRole('button', { name: /后端开发与接口交接/ })).toHaveCount(0);
  await audience.selectOption({ label: '测试工程师' });
  await expect(library.getByRole('button', { name: /后端开发与接口交接/ })).toBeVisible();
  await library.getByRole('button', { name: /图片与截图识别/ }).click();
  await expect(details.getByRole('heading', { name: '图片与截图识别', exact: true })).toBeVisible();
  await expect(details.getByText('应用助手', { exact: true })).toBeVisible();
  await expect(details.getByText('测试工程师', { exact: true })).toBeVisible();
  await audience.selectOption('');

  await library.getByRole('button', { name: /页面检查/ }).click();
  await expect(details.getByRole('heading', { name: '页面检查', exact: true })).toBeInViewport();
  await expect(library.getByRole('button', { name: '新建 Skill' })).toBeInViewport();
  await library.getByRole('button', { name: '新建 Skill' }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('SKILL.md', { exact: true }).fill(source('weekly-report-e2e', '先展示已核验的数字。'));
  await editor.getByRole('button', { name: '保存 Skill' }).click();
  await expect(library.getByRole('button', { name: /weekly-report-e2e/ })).toBeVisible();

  const file = page.waitForEvent('filechooser');
  await library.getByRole('button', { name: '导入 SKILL.md' }).click();
  await (await file).setFiles({
    name: 'SKILL.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(source('sheet-review-e2e', '检查表头和空行。')),
  });
  await expect(editor.getByLabel('SKILL.md', { exact: true })).toHaveValue(/sheet-review-e2e/);
  await editor.getByRole('button', { name: '保存 Skill' }).click();
  await expect(library.getByRole('button', { name: /sheet-review-e2e/ })).toBeVisible();

  await library.getByRole('button', { name: /weekly-report-e2e/ }).click();
  await details.getByRole('button', { name: '编辑使用范围' }).click();
  await editor.getByRole('checkbox', { name: '允许助手在对话中手动选用' }).uncheck();
  await editor.getByRole('button', { name: '添加项目流程' }).click();
  await editor.getByRole('combobox', { name: '项目', exact: true }).selectOption(project.id);
  await editor.getByRole('combobox', { name: '流程', exact: true }).selectOption('feature');
  await editor.getByRole('combobox', { name: '流程中的使用角色' }).selectOption('specific');
  await editor.getByRole('checkbox', { name: '评审员', exact: true }).check();
  await editor.getByRole('button', { name: '保存 Skill' }).click();
  await expect(details.getByText('未在助手中启用。')).toBeVisible();
  await expect(details.getByText('评审员', { exact: true })).toBeVisible();
  await library.getByRole('combobox', { name: '按使用对象筛选' }).selectOption({ label: '评审员' });
  await expect(library.getByRole('button', { name: /weekly-report-e2e/ })).toBeVisible();
  await expect(library.getByRole('button', { name: /sheet-review-e2e/ })).toHaveCount(0);
  await page.goto(`/?projectId=${project.id}&workflow=feature`);
  await expect(page.getByText('weekly-report-e2e · v1', { exact: true })).toBeVisible();

  await queueAssistantTurn(request, [{ type: 'text', text: '已按约定整理。' }]);
  await page.goto('/');
  await page.getByRole('button', { name: '选择 Skill' }).click();
  await expect(editor.getByRole('checkbox', { name: /weekly-report-e2e/ })).toHaveCount(0);
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
  await expect(page).toHaveURL(/\/skills$/);
  await expect(library.getByRole('button', { name: /draft-report-e2e/ })).toBeVisible();
});
