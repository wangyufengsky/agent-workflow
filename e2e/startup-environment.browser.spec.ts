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
    await settings.getByRole('button', { name: '启动环境变量', exact: true }).click();
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

test('专业设置独立保存多个模型请求头，重开后可以编辑、保留密钥和删除', async ({ page, request }) => {
  const screenshots = process.env.AW_STARTUP_ENVIRONMENT_SCREENSHOTS;
  await page.setViewportSize({ width: 1440, height: 1050 });
  const headersUrl = `${API_BASE}/settings/opencode-headers`;
  const envUrl = `${API_BASE}/settings/startup-environment`;
  const set = (url: string, items: object[]) => request.put(url, { headers: AUTH, data: { items } });
  await createProject(request, null);
  await patchSettings(request, { 'ui.mode': 'pro', 'ui.theme': 'codex' });
  await expect(await set(envUrl, [{ name: 'JAVA_HOME', secret: false, value: '/opt/jdk-17' }])).toBeOK();
  await expect(await set(headersUrl, [])).toBeOK();
  try {
    await page.goto('/settings');
    const headers = page.getByRole('region', { name: 'OpenCode 模型请求头' });
    const env = page.getByRole('region', { name: '启动环境变量', exact: true });
    const toggleEnv = env.getByRole('button', { name: '启动环境变量', exact: true });
    const toggleHeaders = headers.getByRole('button', { name: 'OpenCode 模型请求头', exact: true });
    await expect(toggleEnv).toHaveAttribute('aria-expanded', 'false');
    await expect(toggleHeaders).toHaveAttribute('aria-expanded', 'false');
    if (screenshots)
      await headers
        .locator('..')
        .screenshot({ path: join(screenshots, 'startup-sections-collapsed.png'), animations: 'disabled' });
    const add = headers.getByRole('button', { name: '添加请求头' });
    const save = headers.getByRole('button', { name: '保存请求头' });
    await add.click();
    const first = headers.getByRole('group', { name: '请求头 1', exact: true });
    const second = headers.getByRole('group', { name: '请求头 2', exact: true });
    await first.getByLabel('请求头名称').fill('X-Client-Name');
    await first.getByLabel('请求头值').fill('agent-workflow');
    await toggleHeaders.click();
    await expect(first).toBeHidden();
    await toggleEnv.click();
    await expect(env.getByLabel('变量值')).toHaveValue('/opt/jdk-17');
    await toggleHeaders.press('Enter');
    await expect(first.getByLabel('请求头值')).toHaveValue('agent-workflow');
    await expect(toggleEnv).toHaveAttribute('aria-expanded', 'true');
    await add.click();
    await second.getByLabel('请求头名称').fill('x-client-name');
    await expect(save).toBeDisabled();
    await second.getByLabel('请求头名称').fill('X-Gateway-Key');
    await second.getByLabel('作为密钥保存').check();
    await second.getByLabel('请求头值').fill('demo-local-only');
    await save.click();
    await expect(headers.getByRole('status')).toContainText('下次启动 OpenCode 时生效');
    await page.reload();
    await toggleHeaders.click();
    await expect(first.getByLabel('请求头值')).toHaveValue('agent-workflow');
    await expect(second.getByLabel('请求头值')).toHaveValue('');
    await expect(second.getByPlaceholder('已保存的密钥不会显示')).toBeVisible();
    if (screenshots)
      await headers
        .locator('..')
        .screenshot({ path: join(screenshots, 'startup-only-headers-open.png'), animations: 'disabled' });
    await toggleEnv.click();
    await expect(env.getByLabel('变量值')).toHaveValue('/opt/jdk-17');
    if (screenshots !== undefined) {
      for (const theme of ['codex', 'default'] as const) {
        await patchSettings(request, { 'ui.theme': theme });
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await headers
          .locator('..')
          .screenshot({ path: join(screenshots, `startup-and-headers-${theme}.png`), animations: 'disabled' });
      }
    }
    await first.getByLabel('请求头值').fill('workflow-desktop');
    await save.click();
    await expect(headers.getByRole('status')).toContainText('已保存');
    const get = async () => (await (await request.get(headersUrl, { headers: AUTH })).json()).items;
    expect(await get()).toEqual([
      { name: 'X-Client-Name', secret: false, value: 'workflow-desktop' },
      { name: 'X-Gateway-Key', secret: true },
    ]);
    await headers.getByRole('button', { name: '移除请求头 2' }).click();
    await save.click();
    await expect.poll(get).toHaveLength(1);
    await expect(env.getByLabel('变量值')).toHaveValue('/opt/jdk-17');
  } finally {
    await set(headersUrl, []);
    await set(envUrl, []);
    await patchSettings(request, { 'ui.mode': 'simple', 'ui.theme': 'codex' });
  }
});
