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

test('我的预览：真实原生视图、只放可见部分、原生页里 ⌘J 回到界面、助手浮层隐藏并仍可读、返回恢复、离开页签解除关联', async ({
  request,
}) => {
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
  await page.getByRole('button', { name: '启动预览', exact: true }).click();
  await expect(page.getByTestId('preview-area')).toBeVisible();
  const nativeCount = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.contentView.children.length);
  await expect.poll(nativeCount).toBe(1);
  for (const theme of THEME_IDS) {
    await request.patch(`${api}/settings`, { headers, data: { 'ui.theme': theme } });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: `screenshots/user-preview-${theme}.png`, animations: 'disabled' });
  }
  // renderer 截图不含原生子视图，另外保存该真实 WebContents 的画面用于走查。
  const nativeImage = await app.evaluate(async ({ BrowserWindow }) => {
    const child = BrowserWindow.getAllWindows()[0]?.contentView.children[0];
    if (child === undefined || !('webContents' in child)) throw new Error('No preview view');
    const contents = child.webContents as Electron.WebContents;
    return (await contents.capturePage()).toPNG().toString('base64');
  });
  writeFileSync('screenshots/user-preview-native.png', Buffer.from(nativeImage, 'base64'));

  // 原生视图不能越过滚动 main 盖住应用顶栏或窗口外：缩窗并把页面区域滚到一半在 main 上方，只放可见的交集。
  const originalBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds());
  // 页面区域最低 460 px，比这时的 main 高：滚动后上下两端都在可见区域之外。
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 420));
  await page.getByRole('main').evaluate((main) => {
    const area = main.querySelector('[data-testid="preview-area"]');
    if (area === null) throw new Error('No preview area');
    main.scrollTop += area.getBoundingClientRect().top - main.getBoundingClientRect().top + 40;
  });
  await expect
    .poll(async () => {
      const main = await page.getByRole('main').boundingBox();
      const area = await page.getByTestId('preview-area').boundingBox();
      const bounds = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.contentView.children[0]?.getBounds(),
      );
      return (
        main !== null &&
        area !== null &&
        bounds !== undefined &&
        area.y < main.y &&
        bounds.y >= main.y &&
        bounds.y + bounds.height <= main.y + main.height
      );
    })
    .toBe(true);
  if (originalBounds === undefined) throw new Error('No app window');
  await app.evaluate(
    ({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0]?.setBounds(bounds),
    originalBounds,
  );
  await page.getByRole('main').evaluate((main) => {
    main.scrollTop = 0;
  });

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

  // 助手的启停使用同一接口：停掉时旧页签随之关闭，外部重启后打开的是新端口上的新页签，旧关联不会复活。
  await request.post(`${api}/tasks/${task.id}/preview/stop`, { headers });
  await expect(page.getByTestId('preview-area')).toHaveCount(0);
  await expect.poll(nativeCount).toBe(0);
  await request.post(`${api}/tasks/${task.id}/preview/start`, { headers });
  await expect(page.getByTestId('preview-area')).toBeVisible();
  await expect.poll(nativeCount).toBe(1);

  const unbound = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/assistant/conversations/${id}/preview`) &&
      response.request().postDataJSON()?.preview === null,
  );
  await page.getByRole('tab', { name: '进度', exact: true }).click();
  expect((await unbound).status()).toBe(204);
  await expect.poll(nativeCount).toBe(0);

  // 回到预览页签：同一个页签放回窗口并重新关联。
  const rebound = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/assistant/conversations/${id}/preview`) &&
      response.request().postDataJSON()?.preview !== null,
  );
  await page.getByRole('tab', { name: '预览', exact: true }).click();
  await expect.poll(nativeCount).toBe(1);
  expect((await rebound).status()).toBe(204);

  // 关联已经写入后暂缓 PUT 回应；用户离开时，这条等待中的消息必须取消并保留草稿。
  await page.keyboard.press('ControlOrMeta+j');
  const bindingReached = Promise.withResolvers<void>();
  const releaseBinding = Promise.withResolvers<void>();
  await page.route(`**/assistant/conversations/${id}/preview`, async (route) => {
    if (route.request().postDataJSON()?.preview === null) return route.continue();
    const response = await route.fetch();
    bindingReached.resolve();
    await releaseBinding.promise;
    return route.fulfill({ response });
  });
  let racedMessages = 0;
  page.on('request', (request) => {
    if (request.url().endsWith(`/assistant/conversations/${id}/messages`) && request.method() === 'POST')
      racedMessages += 1;
  });
  await page.getByRole('textbox', { name: '发给助手的消息' }).fill('等待关联时我已经离开了预览');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await bindingReached.promise;
  const routeUnbound = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/assistant/conversations/${id}/preview`) &&
      response.request().postDataJSON()?.preview === null,
  );
  await page.getByRole('navigation').getByRole('link', { name: '项目', exact: true }).click();
  await expect(page.getByTestId('preview-area')).toHaveCount(0);
  releaseBinding.resolve();
  expect((await routeUnbound).status()).toBe(204);
  await expect.poll(nativeCount).toBe(0);
  await expect(page.getByText('当前预览或对话已切换，本条消息尚未发送。请确认后重试。')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '发给助手的消息' })).toHaveValue('等待关联时我已经离开了预览');
  expect(racedMessages).toBe(0);
});
