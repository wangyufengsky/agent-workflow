import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type ElectronApplication, _electron as electron, expect, type Page, test } from '@playwright/test';
import { createRepo } from './helpers.ts';

/** The desktop app's `electron` dependency resolves to the path of its executable. */
const electronPath: string = createRequire(join(process.cwd(), 'apps/desktop/package.json'))('electron');

// Linux credential store (D167, 17 §3.6), with the built app. CI's Linux runners have no desktop environment under
// xvfb, which Chromium would answer with its hard-coded key. The smoke runs without a Secret Service (master
// password); a second CI step runs this file again under a D-Bus session with an unlocked gnome-keyring and sets
// AW_E2E_SECRET_SERVICE=1.
const secretService = process.env.AW_E2E_SECRET_SERVICE === '1';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (address === null || typeof address === 'string') throw new Error('No TCP port');
  return address.port;
}

async function launch(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['apps/desktop', `--user-data-dir=${userDataDir}`] });
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'Everything is a Workflow.' })).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(page.getByRole('heading', { name: '欢迎使用 Agent Workflow' })).toBeVisible();
  return { app, page };
}

test.describe('Linux 凭据存储（D167）', () => {
  test.skip(process.platform !== 'linux', 'Chromium chooses a key store by desktop environment only on Linux');

  // Playwright's Electron loader appends `--password-store=basic` (its Chromium defaults), which the app keeps as the
  // user's own choice: here the built app starts as a user starts it, and the test attaches over CDP.
  test('桌面环境识别不了时也用正在运行的 Secret Service', async () => {
    test.skip(!secretService, 'needs an unlocked gnome-keyring on the session bus');
    const port = await freePort();
    const userDataDir = mkdtempSync(join(tmpdir(), 'aw-e2e-secret-service-'));
    const child = spawn(electronPath, [
      'apps/desktop',
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${port}`,
    ]);
    const exited = new Promise((resolve) => child.once('exit', resolve));
    try {
      await expect
        .poll(() =>
          fetch(`http://127.0.0.1:${port}/json/version`).then(
            (r) => r.ok,
            () => false,
          ),
        )
        .toBe(true);
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      const [context] = browser.contexts();
      if (context === undefined) throw new Error('No browser context over CDP');
      await expect.poll(() => context.pages().length).toBeGreaterThan(0);
      const [page] = context.pages();
      if (page === undefined) throw new Error('No window over CDP');
      await expect(page.getByRole('heading', { name: 'Everything is a Workflow.' })).toBeVisible();
      await page.mouse.click(10, 10);
      const check = page.getByTestId('check-凭据存储');
      await expect(check).toContainText('已就绪');
      await expect(check).toContainText('系统密钥服务');
      await browser.close();
    } finally {
      child.kill();
      await exited;
    }
  });

  test('没有密钥服务时设置主密码，重启后解锁', async () => {
    test.skip(secretService, 'runs where no Secret Service answers');
    const userDataDir = mkdtempSync(join(tmpdir(), 'aw-e2e-master-password-'));
    const first = await launch(userDataDir);
    const check = first.page.getByTestId('check-凭据存储');
    try {
      await expect(check).toContainText('不可用');
      await check.getByLabel('主密码', { exact: true }).fill('correct horse');
      await check.getByLabel('再输入一次').fill('correct horse');
      await check.getByRole('button', { name: '设置主密码' }).click();
      await expect(check).toContainText('已就绪');
    } finally {
      await first.app.close();
    }

    const second = await launch(userDataDir);
    const again = second.page.getByTestId('check-凭据存储');
    try {
      await expect(again).toContainText('已锁定');
      await again.getByLabel('主密码', { exact: true }).fill('correct horse');
      await again.getByRole('button', { name: '解锁' }).click();
      await expect(again).toContainText('已就绪');
    } finally {
      await second.app.close();
    }
  });
});

/** The backend as the renderer calls it, with the app's own token. */
function send(page: Page, method: string, path: string, body: unknown): Promise<void> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(`/api/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${window.aw?.apiToken ?? ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
    },
    { method, path, body },
  );
}

async function open(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['apps/desktop', `--user-data-dir=${userDataDir}`] });
  const page = await app.firstWindow();
  // The opening animation is a data: page that a click skips (28 §5); then the app loads from the backend.
  await page.mouse.click(10, 10);
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60_000 });
  return { app, page };
}

/** Unlocking derives the key with scrypt (128 MiB, D167): seconds on a busy runner. */
const UNLOCK_TIMEOUT_MS = 20_000;

/** A project, a master password and the given settings; the app started again, so the password is locked. */
async function openLocked(prefix: string, settings: Record<string, unknown> = {}) {
  const userDataDir = mkdtempSync(join(tmpdir(), prefix));
  const first = await open(userDataDir);
  try {
    await send(first.page, 'POST', '/credentials/master-password', { password: 'correct horse' });
    await send(first.page, 'POST', '/projects', { repoPath: createRepo() });
    await send(first.page, 'PATCH', '/settings', settings);
  } finally {
    await first.app.close();
  }
  return open(userDataDir);
}

// Whatever the key store: a master password set earlier is locked again at every start (D167). Every page then says
// so and unlocks in place (D178).
test('主密码锁定时每个页面顶部提示，就地解锁', async () => {
  // The app starts twice.
  test.slow();
  const { app, page } = await openLocked('aw-e2e-locked-banner-');
  try {
    const banner = page.getByRole('region', { name: '凭据存储' });
    await expect(banner).toContainText('本次启动还没有解锁');
    await banner.getByLabel('主密码', { exact: true }).fill('wrong horse');
    await banner.getByRole('button', { name: '解锁' }).click();
    await expect(banner.getByRole('alert')).toBeVisible({ timeout: UNLOCK_TIMEOUT_MS });
    await banner.getByLabel('主密码', { exact: true }).fill('correct horse');
    await banner.getByRole('button', { name: '解锁' }).click();
    await expect(banner).toBeHidden({ timeout: UNLOCK_TIMEOUT_MS });
  } finally {
    await app.close();
  }
});

// The unlock under an error often sits in the form that failed (a database connection, a token): unlocking must not
// submit that form again. Saving answers CREDENTIAL_LOCKED here on every platform, as on a Linux without a key store.
test('表单里的错误就地解锁，不会再次提交表单', async () => {
  // The app starts twice.
  test.slow();
  const { app, page } = await openLocked('aw-e2e-locked-form-', { 'ui.mode': 'pro' });
  try {
    let saves = 0;
    await page.route('**/api/v1/db-connections', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      saves += 1;
      return route.fulfill({
        status: 423,
        json: { error: { code: 'CREDENTIAL_LOCKED', message: 'Master password not entered since start' } },
      });
    });
    await page.goto(new URL('/databases', page.url()).href);
    await page.getByRole('button', { name: '添加连接' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('名称').fill('shop-db');
    await dialog.getByLabel('主机').fill('127.0.0.1');
    await dialog.getByLabel('数据库', { exact: true }).fill('shop');
    await dialog.getByLabel('用户名').fill('app');
    await dialog.getByRole('button', { name: '保存' }).click();
    await dialog.getByLabel('主密码', { exact: true }).fill('correct horse');
    await dialog.getByRole('button', { name: '解锁' }).click();
    await expect(dialog).toContainText('已解锁，请再试一次', { timeout: UNLOCK_TIMEOUT_MS });
    expect(saves).toBe(1);
  } finally {
    await app.close();
  }
});
