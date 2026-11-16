import { expect } from '@playwright/test';
import { test } from './assistant-fixtures.ts';
import { API_BASE, AUTH } from './env.ts';
import { createProject, patchSettings, queueAssistantTurn } from './helpers.ts';

test('项目会话从主页到侧栏保持归属，新草稿可切换项目', async ({ page, request }) => {
  await patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' });
  const a = await createProject(request, null);
  const b = await createProject(request, null);
  await queueAssistantTurn(request, [{ type: 'text', text: '收到项目问题。' }]);
  await page.goto(`/projects/${a.id}`);
  await page.getByRole('link', { name: '问这个项目' }).click();
  await expect(page.getByLabel('会话项目')).toHaveValue(a.id);
  await page.getByLabel('告诉助手，或开始任务').fill('查看这个项目');
  await page.getByLabel('告诉助手，或开始任务').press('ControlOrMeta+Enter');
  await expect(page.getByTestId('home-messages')).toContainText('收到项目问题。');
  await expect(page.getByLabel('会话项目')).toHaveValue(a.id);
  await page.goto(`/projects/${b.id}`);
  await page.getByRole('button', { name: /打开助手/ }).click();
  const panel = page.getByRole('complementary', { name: '应用助手' });
  await expect(panel.getByLabel('会话项目')).toHaveValue(a.id);
  await panel.getByLabel('会话项目').selectOption(b.id);
  await expect(panel.getByLabel('会话项目')).toHaveValue(b.id);
  await panel.getByRole('button', { name: '切换对话' }).click();
  await panel.getByRole('menuitemradio').filter({ hasText: '查看这个项目' }).click();
  await expect(panel.getByLabel('会话项目')).toHaveValue(a.id);
  const list = await (await request.get(`${API_BASE}/assistant/conversations`, { headers: AUTH })).json();
  expect(list.items.find((c: { title: string }) => c.title === '查看这个项目').projectId).toBe(a.id);
});
