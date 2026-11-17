import { expect } from '@playwright/test';
import { test } from './assistant-fixtures.ts';
import { appTool, createProject, patchSettings, queueAssistantTurn } from './helpers.ts';

test('确认项目记忆后，在独立菜单筛选、回到来源并管理记忆', async ({ page, request }) => {
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

  const nav = page.getByRole('navigation', { name: 'Agent Workflow' });
  await nav.getByRole('link', { name: '助手记忆' }).click();
  await expect(page.getByRole('main').getByRole('heading', { name: '助手记忆', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: '按项目筛选' }).selectOption(project.id);

  const list = page.getByRole('region', { name: '记忆列表' });
  const detail = page.getByRole('complementary', { name: '记忆详情' });
  await list.getByRole('button', { name: new RegExp(content) }).click();
  await expect(detail).toContainText(`${project.name}的助手对话`);
  await expect(detail).toContainText('助手提议 · 用户确认');
  await detail.getByRole('link', { name: '查看原始对话' }).click();
  await expect(page.getByTestId('home-messages')).toContainText(`记住，${content}`);

  await nav.getByRole('link', { name: '助手记忆' }).click();
  const personal = '记忆页面验收：周报先写结论。';
  await page.getByRole('button', { name: '新增记忆' }).click();
  const add = page.getByRole('dialog', { name: '新增记忆' });
  await add.getByLabel('记忆正文').fill(personal);
  await add.getByRole('button', { name: '保存', exact: true }).click();
  await expect(detail).toContainText(personal);
  await expect(detail).toContainText('所有助手对话');
  await expect(detail).toContainText('无可用来源对话');
  await expect(list.getByRole('listitem').first()).toContainText(personal);
  await list.getByRole('button', { name: '按更新时间从旧到新排序' }).click();
  await expect(list.getByRole('listitem').last()).toContainText(personal);
  await page.getByRole('button', { name: /个人偏好/ }).click();
  await expect(list.getByText(content, { exact: true })).toHaveCount(0);
  await page.getByRole('searchbox', { name: '搜索记忆' }).fill('周报先写结论');
  await expect(list.getByRole('listitem')).toHaveCount(1);

  await page.getByRole('searchbox').fill(content);
  await expect(list.getByText('没有找到匹配的记忆。')).toBeVisible();
  await page.getByRole('combobox', { name: '按项目筛选' }).selectOption(project.id);
  await expect(detail).toContainText(content);

  await detail.getByRole('button', { name: '修改记忆' }).click();
  const edit = page.getByRole('dialog', { name: '修改记忆' });
  await edit.getByLabel('记忆正文').fill(revised);
  await edit.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('searchbox').fill(revised);
  await expect(detail).toContainText(revised);
  await detail.getByRole('button', { name: '删除记忆' }).click();
  await page.getByRole('dialog', { name: '删除记忆' }).getByRole('button', { name: '删除记忆' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(0);
});
