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
    await patchSettings(request, { 'ai.defaultModel': 'opencode/fake-model-2' });
    await page.reload();
    await page.getByRole('button', { name: '审批员', exact: true }).click();
    await page.getByRole('button', { name: '复制', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('combobox', { name: '思考强度' })).toBeDisabled();
    await dialog.getByLabel('标识').fill('copied_effort_role');
    const created = page.waitForResponse((r) => r.url().endsWith('/roles') && r.request().method() === 'POST');
    await dialog.getByRole('button', { name: '保存' }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const copy = await response.json();
    expect(copy.effort).toBeNull();
    await request.delete(API_BASE + '/roles/' + copy.id, { headers: AUTH });
    await expect(dialog).toHaveCount(0);
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

test('专业设置和角色详情的模型与强度宽屏对齐，窄窗口分行', async ({ page, request }, testInfo) => {
  await createProject(request, null);
  const settings = await (await request.get(API_BASE + '/settings', { headers: AUTH })).json();
  try {
    await patchSettings(request, { 'ui.mode': 'pro', 'ui.theme': 'default', 'ai.defaultModel': 'opencode/fake-model' });
    for (const [path, label] of [
      ['/settings', '默认模型'],
      ['/roles', '模型'],
    ] as const) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(path);
      const model = page.getByRole('combobox', { name: label, exact: true });
      const effort = page.getByRole('combobox', { name: '思考强度', exact: true });
      await expect(effort).toBeEnabled();
      if (path === '/settings') {
        await page.getByRole('region', { name: '专业设置', exact: true }).evaluate((el) => el.scrollIntoView());
      }
      const top = (field: typeof model) => field.evaluate((el) => el.getBoundingClientRect().top);
      expect(Math.abs((await top(model)) - (await top(effort)))).toBeLessThan(1);
      await page.screenshot({ path: testInfo.outputPath(path.slice(1) + '.png'), animations: 'disabled' });
      await page.setViewportSize({ width: 640, height: 800 });
      await expect.poll(async () => (await top(effort)) - (await top(model))).toBeGreaterThan(40);
    }
  } finally {
    await patchSettings(request, {
      'ui.mode': settings['ui.mode'],
      'ui.theme': settings['ui.theme'],
      'ai.defaultModel': settings['ai.defaultModel'],
      'ai.defaultEffort': settings['ai.defaultEffort'],
    });
  }
});
