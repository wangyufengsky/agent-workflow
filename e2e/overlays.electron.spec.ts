import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { createRepo } from './helpers.ts';

// A tab placed on the window is a native view drawn above the whole page (29 §8.1): while the ⌘K palette or a dialog
// is open it leaves the window, and it comes back when they close. The built app with a fresh user data directory;
// no opencode or model is needed. The tab is the website login of the settings page (29 §8.6).
test('网站登录的标签页在 ⌘K 打开时离开窗口，关闭后回来', async () => {
  const site = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<title>登录</title><h1>请登录</h1>');
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  const address = site.address();
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP address');

  const userDataDir = mkdtempSync(join(tmpdir(), 'aw-e2e-overlays-'));
  const app = await electron.launch({ args: ['apps/desktop', `--user-data-dir=${userDataDir}`] });
  try {
    const page = await app.firstWindow();
    // The opening animation is a data: page that a click skips (28 §5); then the app loads from the backend.
    await page.mouse.click(10, 10);
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60_000 });
    // With a project the app leaves onboarding for its pages.
    const repoPath = createRepo();
    await page.evaluate(async (repo) => {
      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { Authorization: `Bearer ${window.aw?.apiToken ?? ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath: repo }),
      });
      if (!res.ok) throw new Error(`POST /projects failed: ${res.status}`);
    }, repoPath);
    await page.goto(new URL('/settings', page.url()).href);

    const views = () =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.contentView.children.length);
    const alone = await views();
    await page.getByLabel('网站地址').fill(`http://127.0.0.1:${address.port}/`);
    await page.getByRole('button', { name: '打开并登录' }).click();
    await expect.poll(views).toBe((alone ?? 0) + 1);

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect.poll(views).toBe(alone);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect.poll(views).toBe((alone ?? 0) + 1);

    await page.getByRole('button', { name: '完成', exact: true }).click();
    await expect.poll(views).toBe(alone);
  } finally {
    await app.close();
    site.close();
  }
});
