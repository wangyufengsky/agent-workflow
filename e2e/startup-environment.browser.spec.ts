import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject, patchSettings } from './helpers.ts';

test('专业设置管理普通与密钥启动变量，并提示完整重启', async ({ page, request }) => {
  const screenshots = process.env.AW_STARTUP_ENVIRONMENT_SCREENSHOTS;
  if (screenshots !== undefined) await page.setViewportSize({ width: 1280, height: 1020 });
  const endpoint = `${API_BASE}/settings/startup-environment`;
  const store = async (items: Array<{ name: string; secret: boolean; value?: string }>) => {
    await expect(await request.put(endpoint, { headers: AUTH, data: { items } })).toBeOK();
  };
  const read = async () => (await (await request.get(endpoint, { headers: AUTH })).json()).items;

  await createProject(request, null);
  await patchSettings(request, { 'ui.mode': 'simple', 'ui.theme': 'codex' });
  await store([]);
  try {
    await page.goto('/settings');
    const settings = page.getByRole('region', { name: '启动环境变量', exact: true });
    await expect(settings).toHaveCount(0);
    await page.getByRole('switch', { name: '专业模式' }).click();
    const add = settings.getByRole('button', { name: '添加变量' });
    const save = settings.getByRole('button', { name: '保存环境变量' });
    await add.click();
    const first = settings.getByRole('group', { name: '变量 1', exact: true });
    const firstName = first.getByRole('textbox', { name: '变量名' });
    await firstName.fill('AW_API_TOKEN');
    await expect(save).toBeDisabled();
    await expect(settings.getByText(/应用保留的名称/)).toBeVisible();
    await firstName.fill('AW_EXAMPLE_MODE');
    await first.getByRole('textbox', { name: '变量值' }).fill('sandbox');
    await add.click();
    const second = settings.getByRole('group', { name: '变量 2', exact: true });
    const secondName = second.getByRole('textbox', { name: '变量名' });
    await secondName.fill('aw_example_mode');
    await expect(save).toBeDisabled();
    await secondName.fill('AW_EXAMPLE_TOKEN');
    await second.getByRole('checkbox', { name: '作为密钥保存' }).check();
    const secretField = second.getByLabel('变量值', { exact: true });
    await expect(secretField).toHaveAttribute('type', 'password');
    await secretField.fill('synthetic-token');
    await save.click();
    await expect(settings.getByRole('status')).toContainText('下次完全退出并重新打开应用时生效');
    await expect.poll(read).toEqual(
      expect.arrayContaining([
        { name: 'AW_EXAMPLE_MODE', secret: false, value: 'sandbox' },
        { name: 'AW_EXAMPLE_TOKEN', secret: true },
      ]),
    );
    await page.reload();
    await expect(settings.getByLabel('变量值', { exact: true }).last()).toHaveValue('');
    await expect(settings.getByPlaceholder('已保存的密钥不会显示')).toBeVisible();
    await expect(settings).not.toContainText('synthetic-token');
    const ordinaryValue = first.getByLabel('变量值', { exact: true });
    await ordinaryValue.fill('second value');
    const preserved = page.waitForRequest(
      (call) => call.method() === 'PUT' && call.url().endsWith('/settings/startup-environment'),
    );
    await save.click();
    expect((await preserved).postDataJSON()).toEqual({
      expectedRevision: expect.any(String),
      items: [
        { name: 'AW_EXAMPLE_MODE', secret: false, value: 'second value' },
        { name: 'AW_EXAMPLE_TOKEN', secret: true },
      ],
    });
    await expect(settings.getByRole('status')).toContainText('已保存');

    await patchSettings(request, { 'ui.theme': 'default' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'default');
    await ordinaryValue.fill('my unsaved edit');
    // Only the hidden secret changed outside this editor; the visible list is identical.
    await store([
      { name: 'AW_EXAMPLE_MODE', secret: false, value: 'second value' },
      { name: 'AW_EXAMPLE_TOKEN', secret: true, value: 'rotated-synthetic-token' },
    ]);
    const conflict = page.waitForResponse(
      (response) => response.request().method() === 'PUT' && response.url().endsWith('/settings/startup-environment'),
    );
    await save.click();
    expect((await conflict).status()).toBe(409);
    await expect(settings.getByRole('status')).toContainText('启动环境变量已被修改');
    await expect(ordinaryValue).toHaveValue('my unsaved edit');
    if (screenshots !== undefined) {
      await settings.screenshot({ path: join(screenshots, 'stale-startup-environment.png'), animations: 'disabled' });
    }
    await settings.getByRole('button', { name: '加载最新设置' }).click();
    await expect(ordinaryValue).toHaveValue('second value');
    await ordinaryValue.fill('');
    await save.click();
    await expect(settings.getByRole('status')).toContainText('已保存');
    await expect.poll(read).toEqual([
      { name: 'AW_EXAMPLE_MODE', secret: false, value: '' },
      { name: 'AW_EXAMPLE_TOKEN', secret: true },
    ]);
    await settings.getByRole('button', { name: '移除变量 2' }).click();
    await settings.getByRole('button', { name: '移除变量 1' }).click();
    await save.click();
    await expect.poll(read).toEqual([]);
  } finally {
    await store([]);
    await patchSettings(request, { 'ui.mode': 'simple', 'ui.theme': 'codex' });
  }
});
