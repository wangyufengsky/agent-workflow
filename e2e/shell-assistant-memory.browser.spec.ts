import { expect } from '@playwright/test';
import { test } from './assistant-fixtures.ts';
import { appTool, createProject, patchSettings, queueAssistantTurn } from './helpers.ts';

test('从项目页开对话，确认记忆后可在设置中修改和删除', async ({ page, request }) => {
  await patchSettings(request, { 'ui.mode': 'simple' });
  const project = await createProject(request, null);
  const content = '交付文档使用墨绿色封面';
  const revised = '交付文档使用深蓝色封面';
  await queueAssistantTurn(request, [
    appTool('memory_create', { scope: 'project', content }),
    { type: 'text', text: '请确认这条项目记忆。' },
  ]);
  await queueAssistantTurn(request, [{ type: 'text', text: '已经保存。' }]);

  await page.goto(`/projects/${project.id}`);
  await page.getByRole('link', { name: '问这个项目' }).click();
  await expect(page.getByRole('button', { name: '会话项目' })).toHaveAccessibleDescription(project.name);
  const input = page.getByRole('textbox', { name: '告诉助手，或开始任务' });
  await input.fill(`记住，${content}`);
  await input.press('ControlOrMeta+Enter');

  const card = page.getByRole('region', { name: '需要你确认：保存助手记忆' });
  await expect(card).toContainText(content);
  await expect(card).toContainText(project.name);
  await expect(card.getByRole('button', { name: /总是允许/ })).toHaveCount(0);
  await card.getByRole('button', { name: '确认', exact: true }).click();
  await expect(card).toContainText('已执行');
  await expect(page.getByRole('button', { name: '会话项目' })).toHaveAccessibleDescription(project.name);

  await page.goto('/settings');
  const manager = page.getByRole('region', { name: '助手记忆' });
  const item = manager.getByRole('listitem').filter({ hasText: content });
  await expect(item.getByRole('link', { name: '查看来源对话' })).toBeVisible();
  await item.getByRole('button', { name: '修改记忆' }).click();
  const edit = page.getByRole('dialog', { name: '修改记忆' });
  await edit.getByLabel('记忆内容').fill(revised);
  await edit.getByRole('button', { name: '保存', exact: true }).click();
  const updated = manager.getByRole('listitem').filter({ hasText: revised });
  await updated.getByRole('button', { name: '删除记忆' }).click();
  await page.getByRole('dialog', { name: '删除记忆' }).getByRole('button', { name: '删除记忆' }).click();
  await expect(updated).toHaveCount(0);
});
