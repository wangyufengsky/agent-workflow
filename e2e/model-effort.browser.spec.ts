import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject, patchSettings } from './helpers.ts';

test('全局与角色按模型目录选档，继承、独立覆盖及模型默认在重新打开后生效', async ({ page, request }) => {
  await createProject(request, null);
  const key = 'opencode/fake-model';
  const settings = await (await request.get(API_BASE + '/settings', { headers: AUTH })).json();
  const roles = await (await request.get(API_BASE + '/roles', { headers: AUTH })).json();
  const approver = roles.items.find((r: { key: string }) => r.key === 'aw-approver');
  const effort = page.getByRole('combobox', { name: '思考强度', exact: true });
  try {
    await patchSettings(request, { 'ui.mode': 'pro', 'ai.defaultModel': key, 'ai.defaultEffort': null });
    await page.goto('/settings');
    await effort.selectOption({ label: 'deep' });
    await expect(effort).toHaveValue('v:deep');
    await page.goto('/roles');
    await page.getByRole('button', { name: '审批员', exact: true }).click();
    await expect(effort.locator('option:checked')).toHaveText('跟随全局 · deep');
    for (const label of ['低', '模型默认']) {
      const saved = page.waitForResponse(
        (r) => r.url().endsWith('/roles/' + approver.id) && r.request().method() === 'PUT',
      );
      await effort.selectOption({ label });
      expect((await saved).ok()).toBe(true);
      await page.reload();
      await page.getByRole('button', { name: '审批员', exact: true }).click();
      await expect(effort.locator('option:checked')).toHaveText(label);
    }
    await page.getByRole('combobox', { name: '模型', exact: true }).selectOption('opencode/fake-model-2');
    await expect(effort).toBeDisabled();
    await expect(page.getByText('OpenCode 未提供可选档位，将使用模型默认。')).toBeVisible();
  } finally {
    await request.put(API_BASE + '/roles/' + approver.id, {
      headers: AUTH,
      data: { model: approver.model, effort: approver.effort },
    });
    await patchSettings(request, {
      'ui.mode': settings['ui.mode'],
      'ai.defaultModel': settings['ai.defaultModel'],
      'ai.defaultEffort': settings['ai.defaultEffort'],
    });
  }
});
