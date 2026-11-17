import { expect, test } from '@playwright/test';
import { createProject, patchSettings } from './helpers.ts';

test('专业模式可保存并清空会话首尾命令', async ({ page, request }) => {
  await createProject(request, null);
  await patchSettings(request, { 'ui.mode': 'pro', 'ai.sessionStartCommand': null, 'ai.sessionEndCommand': null });
  await page.goto('/settings');
  const start = page.getByRole('textbox', { name: '会话开始命令' });
  const end = page.getByRole('textbox', { name: '会话结束命令' });
  await expect(start).toHaveValue('');
  await expect(end).toHaveValue('');

  for (const [input, command] of [
    [start, '/report start'],
    [end, '/report complete'],
  ] as const) {
    await input.fill(command);
    const saving = page.waitForResponse((res) => res.url().endsWith('/settings') && res.request().method() === 'PATCH');
    await input.press('Enter');
    expect((await saving).ok()).toBe(true);
  }
  await page.reload();
  await expect(start).toHaveValue('/report start');
  await expect(end).toHaveValue('/report complete');
  for (const input of [start, end]) {
    await input.clear();
    const saving = page.waitForResponse((res) => res.url().endsWith('/settings') && res.request().method() === 'PATCH');
    await input.press('Enter');
    expect((await saving).ok()).toBe(true);
  }
  await page.reload();
  await expect(start).toHaveValue('');
  await expect(end).toHaveValue('');
});
