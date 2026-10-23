import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, type Page, test } from '@playwright/test';
import { createRepo, git } from './helpers.ts';

// J30 (29 §8.1): the task page's preview tab in the built app. The user starts the task's preview; their own tab is
// a real page of it placed in the window: it follows the address bar, counts the page's console errors, leaves the
// window on the progress tab and when the app's page reloads, and the app still quits with the tab open. A bug-fix
// task waiting for its plan to be confirmed has its worktree, so no opencode or model is needed.

const SERVER = `import { createServer } from 'node:http';
const pages = {
  '/': '<title>首页</title><h1>首页</h1>',
  '/broken': '<title>坏了</title><h1>坏了</h1><script>console.error("boom")</script>',
};
createServer((req, res) => {
  const body = pages[req.url];
  res.writeHead(body === undefined ? 404 : 200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body ?? 'not found');
}).listen(Number(process.env.PORT), '127.0.0.1', () => console.log('listening'));
`;

/** A call of the app's API from its window, with its per-launch token. */
function api(page: Page, method: string, path: string, body?: unknown): Promise<{ id: string; status?: string }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(`/api/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${window.aw?.apiToken ?? ''}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${await res.text()}`);
      return res.json();
    },
    { method, path, body },
  );
}

test('J30 任务页预览：真实页面放进窗口，跟随地址栏，统计控制台错误；切到进度或重新加载时离开窗口，开着时也能正常退出', async () => {
  // Launching the app, the task's worktree and the dev server's start add up past the default 30 s.
  test.setTimeout(180_000);
  const repoPath = createRepo();
  writeFileSync(join(repoPath, 'server.mjs'), SERVER);
  git(repoPath, 'add', '-A');
  git(repoPath, 'commit', '-q', '-m', 'dev server');
  const userDataDir = mkdtempSync(join(tmpdir(), 'aw-e2e-preview-'));
  const app = await electron.launch({ args: ['apps/desktop', `--user-data-dir=${userDataDir}`] });
  try {
    const page = await app.firstWindow();
    await page.mouse.click(10, 10);
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60_000 });

    const project = await api(page, 'POST', '/projects', { repoPath });
    await api(page, 'PATCH', `/projects/${project.id}`, {
      preview: { command: 'node server.mjs', setupCommand: null, readyPath: '/', pages: ['/'], extraOrigins: [] },
    });
    const workflows = (await api(page, 'GET', '/workflows')) as unknown as { items: { id: string; key: string }[] };
    const bugfix = workflows.items.find((w) => w.key === 'bugfix');
    const task = await api(page, 'POST', '/tasks', {
      projectId: project.id,
      workflowId: bugfix?.id,
      requirement: '首页报错',
      checkpoints: { confirm_plan: true },
    });
    await expect
      .poll(async () => (await api(page, 'GET', `/tasks/${task.id}`)).status, { timeout: 30_000 })
      .toBe('plan_review');

    const views = () =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.contentView.children.length ?? 0);
    const placedUrl = () =>
      app.evaluate(({ BrowserWindow }) => {
        const children = BrowserWindow.getAllWindows()[0]?.contentView.children ?? [];
        const last = children.at(-1);
        return last !== undefined && 'webContents' in last
          ? (last as Electron.WebContentsView).webContents.getURL()
          : '';
      });
    const alone = await views();

    await page.goto(new URL(`/tasks/${task.id}?view=preview`, page.url()).href);
    const pane = page.getByTestId('preview-pane');
    await expect(pane).toContainText('预览还没有启动');
    await pane.getByRole('button', { name: '启动预览' }).click();
    await expect(pane).toContainText('运行中', { timeout: 60_000 });
    await expect.poll(views).toBe(alone + 1);
    await expect.poll(placedUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    await expect(pane).toContainText('运行中');
    await expect(pane).toContainText('控制台错误 0 · 失败请求 0');

    const address = pane.getByLabel('页面路径');
    await address.fill('/broken');
    await address.press('Enter');
    await expect.poll(placedUrl).toMatch(/\/broken$/);
    await expect(pane).toContainText('控制台错误 1 · 失败请求 0');
    await expect(address).toHaveValue('/broken');

    await page.getByRole('tab', { name: '进度' }).click();
    await expect.poll(views).toBe(alone);
    await page.getByRole('tab', { name: '预览' }).click();
    await expect.poll(views).toBe(alone + 1);

    // A reload starts the page over: the tab leaves the window although no cleanup of the page ran.
    await page.goto(new URL('/tasks', page.url()).href);
    await expect.poll(views).toBe(alone);
  } finally {
    await app.close();
  }
});
