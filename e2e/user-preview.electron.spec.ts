import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_IDS } from '@aw/shared';
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test';
import { createRepo, git } from './helpers.ts';

declare global {
  var previewHarness: { token: string; ready: Promise<string> };
}
let app: ElectronApplication;
test.afterEach(async () => {
  await app.close();
});

test('我的预览：真实原生视图、助手浮层隐藏并仍可读、返回恢复、离开页签解除关联', async ({ request }) => {
  app = await electron.launch({ args: ['e2e/fixtures/user-preview/main.cjs'] });
  const base = await app.evaluate(async () => globalThis.previewHarness.ready);
  const token = await app.evaluate(() => globalThis.previewHarness.token);
  const headers = { Authorization: `Bearer ${token}` };
  const api = `${base}/api/v1`;
  const page = await app.firstWindow();
  const repoPath = createRepo();
  writeFileSync(
    join(repoPath, 'server.mjs'),
    `import { createServer } from 'node:http';
createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8');
res.end('<title>我的测试预览</title><h1>只有用户预览的内容</h1>');
}).listen(Number(process.env.PORT), '127.0.0.1');`,
  );
  git(repoPath, 'add', '.');
  git(repoPath, 'commit', '-m', 'add preview');
  const project = await (await request.post(`${api}/projects`, { headers, data: { repoPath } })).json();
  await request.patch(`${api}/projects/${project.id}`, {
    headers,
    data: {
      checkCommand: null,
      preview: { command: 'node server.mjs', setupCommand: null, readyPath: '/', pages: ['/'], extraOrigins: [] },
    },
  });
  const workflows = await (await request.get(`${api}/workflows`, { headers })).json();
  const workflow = workflows.items.find((item: { key: string }) => item.key === 'bugfix');
  const task = await (
    await request.post(`${api}/tasks`, {
      headers,
      data: {
        projectId: project.id,
        workflowId: workflow.id,
        requirement: '预览归属验收',
        start: true,
        checkpoints: { confirm_plan: true },
      },
    })
  ).json();
  await expect
    .poll(async () => (await (await request.get(`${api}/tasks/${task.id}`, { headers })).json()).status)
    .toBe('plan_review');
  await page.goto(`${base}/tasks/${task.id}`);
  await page.getByRole('tab', { name: '预览', exact: true }).click();
  await page.getByRole('button', { name: '打开我的预览', exact: true }).click();
  await expect(page.getByTestId('user-preview-area')).toBeVisible();
  const nativeCount = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.contentView.children.length);
  await expect.poll(nativeCount).toBe(1);
  for (const theme of THEME_IDS) {
    await request.patch(`${api}/settings`, { headers, data: { 'ui.theme': theme } });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: `screenshots/user-preview-${theme}.png` });
  }
  // renderer 截图不含原生子视图，另外保存该真实 WebContents 的画面用于走查。
  const nativeImage = await app.evaluate(async ({ BrowserWindow }) => {
    const child = BrowserWindow.getAllWindows()[0]?.contentView.children[0];
    if (child === undefined || !('webContents' in child)) throw new Error('No preview view');
    const contents = child.webContents as Electron.WebContents;
    return (await contents.capturePage()).toPNG().toString('base64');
  });
  writeFileSync('screenshots/user-preview-native.png', Buffer.from(nativeImage, 'base64'));

  // 焦点在原生页面里时，真实快捷键也必须回到主界面。
  await app.evaluate(({ BrowserWindow }) => {
    const child = BrowserWindow.getAllWindows()[0]?.contentView.children[0];
    if (child === undefined || !('webContents' in child)) throw new Error('No preview view');
    const contents = child.webContents as Electron.WebContents;
    contents.focus();
    contents.sendInputEvent({
      type: 'keyDown',
      keyCode: 'J',
      modifiers: [process.platform === 'darwin' ? 'meta' : 'control'],
    });
  });
  await expect(page.getByRole('complementary', { name: '应用助手' })).toBeVisible();
  await expect.poll(nativeCount).toBe(0);
  await request.post(`${api}/dev/fake-opencode/scripts`, {
    headers,
    data: {
      match: { agent: 'aw-assistant' },
      steps: [
        { type: 'callTool', server: 'assistant', name: 'browser_read', args: {} },
        { type: 'text', text: '已读取当前预览。' },
      ],
    },
  });
  await page.getByRole('textbox', { name: '发给助手的消息' }).fill('读取我的预览');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText('已读取当前预览。', { exact: true })).toBeVisible();
  const conversations = await (await request.get(`${api}/assistant/conversations`, { headers })).json();
  const id = conversations.items[0].id;
  const transcript = await (await request.get(`${api}/assistant/conversations/${id}/transcript`, { headers })).json();
  expect(JSON.stringify(transcript)).toContain('只有用户预览的内容');
  await page.getByRole('complementary', { name: '应用助手' }).getByRole('button', { name: '收起助手' }).click();
  await expect.poll(nativeCount).toBe(1);

  // 助手的启停使用同一接口：外部重启不能让旧用户关联自动复活。
  await request.post(`${api}/tasks/${task.id}/preview/stop`, { headers });
  await expect(page.getByTestId('user-preview-area')).toHaveCount(0);
  await request.post(`${api}/tasks/${task.id}/preview/start`, { headers });
  await expect(page.getByRole('button', { name: '打开我的预览', exact: true })).toBeVisible();
  await expect(page.getByTestId('user-preview-area')).toHaveCount(0);
  await page.getByRole('button', { name: '打开我的预览', exact: true }).click();
  await expect.poll(nativeCount).toBe(1);

  const unbound = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/assistant/conversations/${id}/preview`) &&
      response.request().postDataJSON()?.preview === null,
  );
  await page.getByRole('tab', { name: '进度', exact: true }).click();
  expect((await unbound).status()).toBe(204);
  await expect.poll(nativeCount).toBe(0);

  await page.getByRole('tab', { name: '预览', exact: true }).click();
  await page.getByRole('button', { name: '打开我的预览', exact: true }).click();
  await expect.poll(nativeCount).toBe(1);
  const routeUnbound = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/assistant/conversations/${id}/preview`) &&
      response.request().postDataJSON()?.preview === null,
  );
  await page.getByRole('navigation').getByRole('link', { name: '项目', exact: true }).click();
  expect((await routeUnbound).status()).toBe(204);
  await expect.poll(nativeCount).toBe(0);
});
