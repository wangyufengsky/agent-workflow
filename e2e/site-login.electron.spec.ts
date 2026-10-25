import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test';
import { createRepo } from './helpers.ts';

// 网站的 HTTP 认证（29 §5.4，D170）：真实后端、renderer 与 WebContentsView。用户在「网站登录」的对话框里输入，
// 之后 AI 用的网站会话（这里是助手的 browser.readUrl）沿用这次登录；登录前它只得到「需要登录」。

const WIKI_AUTH = `Basic ${Buffer.from('reader:secret').toString('base64')}`;
let app: ElectronApplication;
let wiki: Server;
test.afterEach(async () => {
  await app.close();
  wiki.close();
});

test('网站登录：HTTP 认证在应用的对话框里完成，之后网站会话沿用登录', async ({ request }) => {
  wiki = createServer((req, res) => {
    const authorized = req.headers.authorization === WIKI_AUTH;
    res.writeHead(authorized ? 200 : 401, {
      'content-type': 'text/html; charset=utf-8',
      ...(authorized ? {} : { 'www-authenticate': 'Basic realm="wiki"' }),
    });
    res.end(authorized ? '<title>接口说明</title><h1>订单接口</h1>' : '<title>401</title>');
  });
  await new Promise<void>((resolve) => wiki.listen(0, '127.0.0.1', resolve));
  const wikiUrl = `http://127.0.0.1:${(wiki.address() as AddressInfo).port}/`;

  app = await electron.launch({ args: ['e2e/fixtures/user-preview/main.cjs'] });
  const base = await app.evaluate(async () => globalThis.previewHarness.ready);
  const token = await app.evaluate(() => globalThis.previewHarness.token);
  const headers = { Authorization: `Bearer ${token}` };
  const api = `${base}/api/v1`;
  // With no project the app shows onboarding instead of the settings.
  await request.post(`${api}/projects`, { headers, data: { repoPath: createRepo() } });
  await request.patch(`${api}/settings`, {
    headers,
    data: { 'browser.sites': [{ pattern: '127.0.0.1', access: 'read' }] },
  });
  const read = () => request.post(`${api}/browser/read-url`, { headers, data: { url: wikiUrl } });
  const before = await read();
  expect(before.status()).toBe(409);
  expect((await before.json()).error.code).toBe('BROWSER_LOGIN_REQUIRED');

  const page = await app.firstWindow();
  await page.goto(`${base}/settings`);
  await page.getByLabel('网站地址').fill(wikiUrl);
  await page.getByRole('button', { name: '打开并登录' }).click();
  const dialog = page.getByRole('dialog', { name: '登录 127.0.0.1' });
  await expect(dialog).toBeVisible();
  // The native tab leaves the window while the dialog is open, so the dialog is not covered (29 §8.1).
  const nativeCount = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.contentView.children.length);
  await expect.poll(nativeCount).toBe(0);
  await page.screenshot({ path: 'screenshots/site-login-http-auth.png', animations: 'disabled' });
  await dialog.getByLabel('用户名').fill('reader');
  await dialog.getByLabel('密码').fill('secret');
  await dialog.getByRole('button', { name: '登录' }).click();
  await expect(dialog).toBeHidden();
  // The tab answers once the website did: its area shows below the rules, placed when scrolled into view.
  await page.getByTestId('login-area').scrollIntoViewIfNeeded();
  await expect.poll(nativeCount).toBe(1);

  await expect.poll(async () => (await read()).status()).toBe(200);
  expect(await (await read()).json()).toMatchObject({ title: '接口说明' });
  await page.getByRole('button', { name: '完成', exact: true }).click();
  // Done closes the login tab; the login stays with the websites' partition for this run.
  expect((await read()).status()).toBe(200);
});
