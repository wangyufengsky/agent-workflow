import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject, patchSettings } from './helpers.ts';

// M5-10 smoke test: ⌘K switches the theme and opens a task.

test('⌘K 命令面板：切换主题、打开任务', async ({ page, request }) => {
  await patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'simple' });
  const project = await createProject(request, null);
  const workflows = await (await request.get(`${API_BASE}/workflows`, { headers: AUTH })).json();
  const bugfix = workflows.items.find((w: { key: string }) => w.key === 'bugfix');
  const created = await request.post(`${API_BASE}/tasks`, {
    headers: AUTH,
    data: { projectId: project.id, workflowId: bugfix.id, requirement: '命令面板要能打开我', start: false },
  });
  const task = await created.json();

  await page.goto('/');
  // The shell's shortcuts listen once the page has rendered.
  await expect(page.getByRole('heading', { name: 'Everything is a Workflow.' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: '命令面板' });
  await palette.getByRole('combobox').fill('DeepSeek');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'deepseek');

  await page.keyboard.press('ControlOrMeta+k');
  await palette.getByRole('combobox').fill(task.key);
  await palette.getByRole('option', { name: new RegExp(`${task.key} · 命令面板要能打开我`) }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}`));
  await patchSettings(request, { 'ui.theme': 'github_white' });
});
