import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

async function boot() {
  const profile = mkdtempSync(join(tmpdir(), 'aw-companion-regression-'));
  const executablePath = process.env.AW_E2E_EXECUTABLE;
  const app = await electron.launch({
    ...(executablePath === undefined ? {} : { executablePath }),
    args: [...(executablePath === undefined ? ['apps/desktop'] : []), `--user-data-dir=${profile}`],
  });
  const main = await app.firstWindow();
  await expect(main.getByRole('heading', { name: 'Everything is a Workflow.' })).toBeVisible();
  await main.mouse.click(10, 10);
  await expect(main.getByRole('heading', { name: '欢迎使用 Agent Workflow' })).toBeVisible();
  const opened = app.waitForEvent('window');
  await main.evaluate(async () => {
    const response = await fetch('/api/v1/settings', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${window.aw?.apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'companion.enabled': true }),
    });
    if (!response.ok) throw new Error('settings failed');
  });
  const pet = await opened;
  await expect(pet.getByRole('button', { name: '和我说说话', exact: true })).toBeVisible();
  return { app, main, pet };
}

test('开启桌宠保持主窗口可见；关闭主窗口后点击 Dock 可重新打开', async () => {
  const { app } = await boot();
  try {
    const state = await app.evaluate(({ BrowserWindow, app }) => ({
      mainVisible: BrowserWindow.getAllWindows()
        .find((w) => !w.webContents.getURL().endsWith('/companion'))
        ?.isVisible(),
      dockVisible: app.dock?.isVisible(),
    }));
    expect.soft(state.mainVisible).toBe(true);
    if (process.platform === 'darwin') expect.soft(state.dockVisible).toBe(true);
    await app.evaluate(({ BrowserWindow, app }) => {
      BrowserWindow.getAllWindows()
        .find((w) => !w.webContents.getURL().endsWith('/companion'))
        ?.close();
      app.emit('activate');
    });
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((w) => !w.webContents.getURL().endsWith('/companion'))
            ?.isVisible(),
        ),
      )
      .toBe(true);
  } finally {
    await app.close();
  }
});

test('收起的角色可拖至屏幕左上角，展开对话后角色不跳位且面板完整可见', async () => {
  const { app, pet } = await boot();
  try {
    const before = await app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/companion'));
      if (!win) throw new Error('no companion');
      return { bounds: win.getBounds(), area: screen.getDisplayMatching(win.getBounds()).workArea };
    });
    const actor = pet.getByRole('button', { name: '和我说说话', exact: true });
    const rect = await actor.boundingBox();
    if (!rect) throw new Error('no actor');
    const dx = before.area.x + 8 - before.bounds.x - rect.x;
    const dy = before.area.y + 8 - before.bounds.y - rect.y;
    await pet.evaluate(
      ({ dx, dy }) => {
        window.aw?.companion.startDrag({ x: 500, y: 500 });
        window.aw?.companion.moveDrag({ x: 500 + dx, y: 500 + dy });
        window.aw?.companion.endDrag();
      },
      { dx, dy },
    );
    const position = async () => {
      const r = await actor.boundingBox();
      const w = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith('/companion'))
          ?.getBounds(),
      );
      if (!r || !w) throw new Error('no companion bounds');
      return { x: w.x + r.x, y: w.y + r.y };
    };
    await expect.poll(position).toEqual({ x: before.area.x + 8, y: before.area.y + 8 });
    await actor.click();
    const dialog = pet.getByRole('dialog', { name: '和我说说话', exact: true });
    await expect(dialog).toBeVisible();
    await expect(pet.getByLabel('发给助手的消息')).toBeFocused();
    await expect.poll(position).toEqual({ x: before.area.x + 8, y: before.area.y + 8 });
    const panel = await dialog.boundingBox();
    const win = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('/companion'))
        ?.getBounds(),
    );
    if (!panel || !win) throw new Error('no panel');
    expect(win.x + panel.x).toBeGreaterThanOrEqual(before.area.x);
    expect(win.y + panel.y).toBeGreaterThanOrEqual(before.area.y);
    expect(win.x + panel.x + panel.width).toBeLessThanOrEqual(before.area.x + before.area.width);
    expect(win.y + panel.y + panel.height).toBeLessThanOrEqual(before.area.y + before.area.height);
    await pet.screenshot({ path: 'screenshots/companion/aurora-corner-chat.png' });
  } finally {
    await app.close();
  }
});
