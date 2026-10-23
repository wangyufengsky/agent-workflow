import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('真实桌宠窗口：沙盒、默认光球、会话与形象同步、主窗隐藏恢复、关闭桌宠', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'aw-e2e-companion-'));
  const app = await electron.launch({ args: ['apps/desktop', `--user-data-dir=${profile}`] });
  try {
    const main = await app.firstWindow();
    await expect(main.getByRole('heading', { name: 'Everything is a Workflow.' })).toBeVisible();
    await main.mouse.click(10, 10);
    await expect(main.getByRole('heading', { name: '欢迎使用 Agent Workflow' })).toBeVisible();
    const opened = app.waitForEvent('window');
    await main.evaluate(async () => {
      const res = await fetch('/api/v1/settings', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${window.aw?.apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 'companion.enabled': true }),
      });
      if (!res.ok) throw new Error('settings update failed');
    });
    const pet = await opened;
    await expect(pet.locator('[data-size="pet"]')).toHaveAttribute('data-appearance', 'orb');
    const bounds = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(
        (win) => new URL(win.webContents.getURL()).pathname === '/companion',
      );
      if (window === undefined) throw new Error('no pet');
      const preferences = window.webContents.getLastWebPreferences();
      return {
        transparent: window.isAlwaysOnTop(),
        sandbox: preferences.sandbox,
        contextIsolation: preferences.contextIsolation,
        nodeIntegration: preferences.nodeIntegration,
        bounds: window.getBounds(),
      };
    });
    expect(bounds).toMatchObject({ transparent: true, sandbox: true, contextIsolation: true, nodeIntegration: false });
    await pet.getByRole('button', { name: '和我说说话', exact: true }).click();
    await pet.getByRole('button', { name: '新对话', exact: true }).click();
    await expect.poll(() => pet.evaluate(async () => window.aw?.companion.getConversation())).not.toBeNull();
    const id = await pet.evaluate(async () => window.aw?.companion.getConversation());
    await expect.poll(() => main.evaluate(async () => window.aw?.companion.getConversation())).toBe(id);
    await main.evaluate(async () => {
      const res = await fetch('/api/v1/settings', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${window.aw?.apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 'companion.appearance': 'whale' }),
      });
      if (!res.ok) throw new Error('settings update failed');
    });
    await expect(pet.locator('[data-size="pet"]')).toHaveAttribute('data-appearance', 'whale');
    await pet.getByRole('button', { name: '收起对话' }).click();
    const handle = await pet.getByRole('button', { name: '和我说说话', exact: true }).boundingBox();
    if (handle === null) throw new Error('no drag handle');
    await pet.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await pet.mouse.down();
    await pet.mouse.move(handle.x + handle.width / 2 - 80, handle.y + handle.height / 2 - 40);
    await pet.mouse.up();
    await expect
      .poll(() =>
        app.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()
              .find((win) => new URL(win.webContents.getURL()).pathname === '/companion')
              ?.getBounds().x,
        ),
      )
      .toBeLessThan(bounds.bounds.x);
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((win) => new URL(win.webContents.getURL()).pathname !== '/companion')
        ?.close();
    });
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((win) => win.isVisible()).length),
      )
      .toBe(1);
    await pet.evaluate(async () => window.aw?.companion.openMain('/onboarding'));
    await expect(main.getByRole('heading', { name: '欢迎使用 Agent Workflow' })).toBeVisible();
    await pet.screenshot({ path: 'screenshots/companion/desktop-whale.png' });
    const closed = pet.waitForEvent('close');
    await main.evaluate(async () => {
      await fetch('/api/v1/settings', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${window.aw?.apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 'companion.enabled': false }),
      });
    });
    await closed;
    expect(app.windows().length).toBe(1);
  } finally {
    await app.close();
  }
});
