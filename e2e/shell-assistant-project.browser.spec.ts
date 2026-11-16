import { expect } from '@playwright/test';
import { test } from './assistant-fixtures.ts';
import { API_BASE, AUTH } from './env.ts';
import { appTool, createProject, patchSettings, queueAssistantTurn } from './helpers.ts';

test('项目会话从主页到侧栏保持归属，新草稿可切换项目', async ({ page, request }) => {
  await patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple', 'assistant.alwaysAllow': [] });
  const a = await createProject(request, null);
  const b = await createProject(request, null);
  await queueAssistantTurn(request, [{ type: 'text', text: '收到项目问题。' }]);
  await page.goto(`/projects/${a.id}`);
  await page.getByRole('link', { name: '问这个项目' }).click();
  await expect(page.getByRole('button', { name: '会话项目' })).toHaveAccessibleDescription(a.name);
  await page.getByLabel('告诉助手，或开始任务').fill('查看这个项目');
  await page.getByLabel('告诉助手，或开始任务').press('ControlOrMeta+Enter');
  await expect(page.getByTestId('home-messages')).toContainText('收到项目问题。');
  await expect(page.getByRole('button', { name: '会话项目' })).toHaveAccessibleDescription(a.name);
  await page.goto(`/projects/${b.id}`);
  await page.getByRole('button', { name: /打开助手/ }).click();
  const panel = page.getByRole('complementary', { name: '应用助手' });
  await expect(panel.getByRole('button', { name: '会话项目' })).toHaveAccessibleDescription(a.name);
  const workflows: { items: { id: string; key: string }[] } = await (
    await request.get(`${API_BASE}/workflows`, { headers: AUTH })
  ).json();
  const workflow = workflows.items.find((item) => item.key === 'feature');
  if (workflow === undefined) throw new Error('Missing feature workflow');
  await queueAssistantTurn(request, [
    appTool('tasks_create', { projectId: a.id, workflowId: workflow.id, requirement: '补充测试与使用说明' }),
  ]);
  const message = panel.getByLabel('发给助手的消息');
  await message.fill('在这个项目建任务，补充测试与使用说明');
  await message.press('ControlOrMeta+Enter');
  const confirmation = panel.getByTestId('confirmation-card');
  await expect(confirmation).toContainText(a.name);
  await expect(confirmation).toContainText('main');
  await expect(confirmation).not.toContainText(b.name);
  await panel.getByRole('button', { name: '会话项目' }).click();
  await panel.getByRole('menu', { name: '会话项目' }).getByRole('menuitemradio', { name: b.name, exact: true }).click();
  await expect(panel.getByRole('button', { name: '会话项目' })).toHaveAccessibleDescription(b.name);
  await panel.getByRole('button', { name: '切换对话' }).click();
  await panel.getByRole('menuitemradio').filter({ hasText: '查看这个项目' }).click();
  await expect(panel.getByRole('button', { name: '会话项目' })).toHaveAccessibleDescription(a.name);
  const list = await (await request.get(`${API_BASE}/assistant/conversations`, { headers: AUTH })).json();
  expect(list.items.find((c: { title: string }) => c.title === '查看这个项目').projectId).toBe(a.id);
});

test('欢迎建议使用已选的草稿项目', async ({ page, request }) => {
  await patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' });
  const a = await createProject(request, null);
  const b = await createProject(request, null);
  await queueAssistantTurn(request, [{ type: 'text', text: '主页建议已处理。' }]);
  await page.goto(`/?assistantProjectId=${a.id}`);
  await expect(page.getByRole('button', { name: '会话项目' })).toHaveAccessibleDescription(a.name);
  await page.getByRole('button', { name: '列出我的项目', exact: true }).click();
  await expect(page.getByTestId('home-messages')).toContainText('主页建议已处理。');
  await expect(page.getByRole('button', { name: '会话项目' })).toHaveAccessibleDescription(a.name);
  await page.goto('/settings');
  await page.getByRole('button', { name: /打开助手/ }).click();
  const panel = page.getByRole('complementary', { name: '应用助手' });
  await panel.getByRole('button', { name: '新对话' }).click();
  const picker = panel.getByRole('button', { name: '会话项目' });
  const projects = panel.getByRole('menu', { name: '会话项目' });
  await picker.press('ArrowDown');
  const general = projects.getByRole('menuitemradio', { name: /通用对话/, checked: true });
  await expect(general).toBeFocused();
  await general.press('ArrowDown');
  await expect(projects.getByRole('menuitemradio', { name: /通用对话/ })).not.toBeFocused();
  await page.keyboard.press('Escape');
  await expect(projects).toBeHidden();
  await expect(picker).toBeFocused();
  await picker.click();
  await projects.getByRole('menuitemradio', { name: b.name, exact: true }).click();
  await queueAssistantTurn(request, [{ type: 'text', text: '侧栏建议已处理。' }]);
  await panel.getByRole('button', { name: '列出我的项目', exact: true }).click();
  await expect(panel).toContainText('侧栏建议已处理。');
  await expect(panel.getByRole('button', { name: '会话项目' })).toHaveAccessibleDescription(b.name);
  const list = await (await request.get(`${API_BASE}/assistant/conversations`, { headers: AUTH })).json();
  const matching = list.items.filter((c: { title: string }) => c.title === '列出我的项目');
  expect(matching.map((c: { projectId: string | null }) => c.projectId)).toEqual(expect.arrayContaining([a.id, b.id]));
});
