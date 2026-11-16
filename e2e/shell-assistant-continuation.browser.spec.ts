import { expect } from '@playwright/test';
import { test } from './assistant-fixtures.ts';
import { appTool, createProject, patchSettings, queueAssistantTurn } from './helpers.ts';

test('超限后续接项目对话、选择附件、回看来源并编辑后发送', async ({ page, request }, testInfo) => {
  await patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple', 'assistant.alwaysAllow': [] });
  const project = await createProject(request, null);
  await queueAssistantTurn(request, [
    appTool('projects_update', { id: project.id, checkCommand: 'pnpm test' }),
    { type: 'text', text: '已确认使用 SQLite。' },
  ]);
  await queueAssistantTurn(request, [{ type: 'error', name: 'ContextOverflowError', message: 'context too long' }]);
  await page.goto(`/?assistantProjectId=${project.id}`);
  const input = page.getByLabel('告诉助手，或开始任务');
  await expect(page.getByRole('button', { name: '会话项目' })).toHaveAccessibleDescription(project.name);
  await input.fill('确认使用 SQLite');
  await input.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('home-messages')).toContainText('已确认使用 SQLite。');
  const sourceUrl = page.url();

  await page.getByRole('button', { name: '添加资料与上下文', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: '上传文件…', exact: true }).click();
  await (await chooser).setFiles({ name: '检查说明.txt', mimeType: 'text/plain', buffer: Buffer.from('需要核对迁移') });
  await expect(page.getByRole('button', { name: '查看 检查说明.txt' })).toBeVisible();
  await input.fill('请检查这项迁移');
  await input.press('ControlOrMeta+Enter');
  const failure = page.getByRole('status').filter({ hasText: '超出模型的上下文容量' });
  await failure.getByRole('button', { name: '续接对话' }).click();
  const dialog = page.getByRole('dialog', { name: '续接对话' });
  await dialog.getByRole('checkbox', { name: '检查说明.txt' }).check();
  await page.screenshot({ path: testInfo.outputPath('continue-light.png') });
  await dialog.getByRole('button', { name: '续接对话' }).click();
  await expect(page).not.toHaveURL(sourceUrl);
  const source = page.getByTestId('continuation-source');
  await expect(source).toContainText('续接自「确认使用 SQLite」');
  await expect(source).toContainText('从来源对话带上的附件');
  await expect(page.getByRole('button', { name: '会话项目' })).toHaveAccessibleDescription(project.name);
  await expect(input).toHaveValue('请检查这项迁移');
  await source.getByRole('button', { name: '查看续接前的消息' }).click();
  const history = page.getByRole('dialog', { name: '查看续接前的消息' });
  await expect(history).toContainText('已确认使用 SQLite。');
  await expect(history).toContainText('请检查这项迁移');
  const oldConfirmation = history.getByTestId('historical-confirmation');
  await expect(oldConfirmation).toContainText('等待确认');
  await expect(oldConfirmation).toContainText('pnpm test');
  await expect(history.getByRole('button', { name: '确认', exact: true })).toHaveCount(0);
  await history.getByRole('button', { name: '关闭' }).click();

  await page.reload();
  await expect(input).toHaveValue('请检查这项迁移');
  await queueAssistantTurn(request, [{ type: 'text', text: '已检查迁移。' }]);
  await input.fill('只检查新增字段');
  await input.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('home-messages')).toContainText('已检查迁移。');
  await expect(input).toHaveValue('');
  await page.reload();
  await expect(page.getByTestId('home-messages')).toContainText('已检查迁移。');
  await expect(input).toHaveValue('');
  await expect(source.getByRole('button', { name: '查看 检查说明.txt' })).toBeVisible();

  await page.goto('/settings');
  await expect(page.getByRole('main').getByRole('heading', { name: '设置' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByRole('complementary', { name: '应用助手' });
  await expect(panel).toContainText('已检查迁移。');
  await panel.getByRole('button', { name: '切换对话' }).click();
  await panel.getByRole('menuitem', { name: '续接对话' }).click();
  await dialog.getByRole('button', { name: '续接对话' }).click();
  await expect(panel.getByTestId('continuation-source')).toContainText('续接自');
  await expect(panel.getByTestId('assistant-user-message')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '会话项目' })).toHaveAccessibleDescription(project.name);
  await patchSettings(request, { 'ui.theme': 'default' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'default');
  await panel.getByRole('button', { name: '查看续接前的消息' }).click();
  await expect(history).toContainText('只检查新增字段');
  await expect(history.getByText('确认使用 SQLite', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('continue-dark.png') });
  await history.getByRole('button', { name: '打开来源对话' }).click();
  await expect(panel.getByTestId('assistant-user-message')).toHaveText('只检查新增字段');
});
