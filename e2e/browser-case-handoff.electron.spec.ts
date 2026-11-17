import { createServer } from 'node:http';
import { _electron as electron, expect, test } from '@playwright/test';
import { createRepo } from './helpers.ts';

test('原生测试页签完成登录后继续，结束时清理测试分区的 Cookie', async ({ request }) => {
  const target = createServer((req, res) => {
    if (req.url === '/session' && req.method === 'POST') {
      res.writeHead(303, { location: '/', 'set-cookie': 'caseLogin=ok; Path=/; HttpOnly' }).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      req.headers.cookie?.includes('caseLogin=ok') === true
        ? '<h1 id="status">已登录</h1>'
        : '<form method="post" action="/session"><input type="password" name="pw"><button>登录</button></form>',
    );
  });
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  try {
    const address = target.address();
    if (address === null || typeof address === 'string') throw new Error('Expected a local HTTP port');
    const url = `http://127.0.0.1:${address.port}/`;
    const app = await electron.launch({ args: ['e2e/fixtures/user-preview/main.cjs'] });
    try {
      const base = await app.evaluate(() => globalThis.previewHarness.ready);
      const token = await app.evaluate(() => globalThis.previewHarness.token);
      const headers = { Authorization: `Bearer ${token}` };
      const api = `${base}/api/v1`;
      const page = await app.firstWindow();
      const project = await request.post(`${api}/projects`, { headers, data: { repoPath: createRepo() } });
      expect(project.status()).toBe(201);
      const { id: projectId } = await project.json();
      const created = await request.post(`${api}/projects/${projectId}/browser-cases`, {
        headers,
        data: {
          definition: {
            name: '登录后的页面',
            scope: { target: url, writes: [] },
            steps: [
              {
                title: '检查登录结果',
                action: { kind: 'check' },
                expect: { kind: 'text', selector: '#status', value: '已登录' },
              },
            ],
          },
        },
      });
      expect(created.status()).toBe(201);
      const { caseId, revision } = await created.json();
      const run = await request.post(`${api}/projects/${projectId}/browser-cases/${caseId}/run`, {
        headers,
        data: { revision, approved: true },
      });
      expect(run.status()).toBe(201);
      const { id } = await run.json();
      await page.goto(`${base}/tasks/${id}`);
      await page.getByRole('button', { name: '打开测试页签' }).click();
      await expect(page.getByText('等待登录 · 打开测试页面')).toBeVisible();
      const { browserCaseHandoff } = await (await request.get(`${api}/tasks/${id}`, { headers })).json();
      const partition = `aw-attempt-${String(browserCaseHandoff.tabId).split(':')[0]}`;
      await expect(page.getByTestId('browser-test-surface')).toBeVisible();
      const count = () =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.contentView.children.length);
      await expect.poll(count).toBe(2);
      await page.getByRole('button', { name: '接管测试页签' }).click();
      await expect(page.getByTestId('case-handoff-surface')).toBeVisible();
      await expect.poll(count).toBe(1);
      await page.getByRole('tab', { name: '进度', exact: true }).click();
      await expect.poll(count).toBe(0);
      await page.getByRole('button', { name: '打开测试页签' }).click();
      await expect(page.getByTestId('case-handoff-surface')).toBeVisible();
      await expect.poll(count).toBe(1);
      await app.evaluate(async ({ BrowserWindow }) => {
        const view = BrowserWindow.getAllWindows()[0]?.contentView.children[0];
        if (view === undefined || !('webContents' in view)) throw new Error('No native test view');
        const contents = view.webContents;
        await contents.debugger.sendCommand('Runtime.evaluate', {
          expression: `document.querySelector('input[type=password]').value = 'test-fixture'; document.forms[0].requestSubmit()`,
        });
      });
      const cookieNames = () =>
        app.evaluate(
          ({ session }, { partition, url }) =>
            session
              .fromPartition(partition)
              .cookies.get({ url })
              .then((cookies) => cookies.map((cookie) => cookie.name)),
          { partition, url },
        );
      await expect.poll(cookieNames).toContain('caseLogin');
      await page.getByRole('button', { name: '验证完成，继续测试' }).click();
      await expect.poll(count).toBe(0);
      await page.getByRole('tab', { name: '进度', exact: true }).click();
      await expect(page.getByTestId('result-card').getByText('步骤 1 · 检查登录结果 · 通过')).toBeVisible();
      await expect.poll(cookieNames).toEqual([]);
    } finally {
      await app.close();
    }
  } finally {
    target.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      target.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  }
});

test('AI 测试的同一原生页签只观看，按需截图，结束后只保留记录', async ({ request }) => {
  let clicks = 0;
  const target = createServer((req, res) => {
    if (req.url?.startsWith('/api/clicked')) {
      clicks += 1;
      res.writeHead(204).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<button onclick="fetch(\'/api/clicked?trace=private\')">执行</button><p id="gate">等待操作</p>');
  });
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  try {
    const address = target.address();
    if (address === null || typeof address === 'string') throw new Error('Expected a local HTTP port');
    const url = `http://127.0.0.1:${address.port}/`;
    const app = await electron.launch({ args: ['e2e/fixtures/user-preview/main.cjs'] });
    try {
      const base = await app.evaluate(() => globalThis.previewHarness.ready);
      const token = await app.evaluate(() => globalThis.previewHarness.token);
      const headers = { Authorization: `Bearer ${token}` };
      const api = `${base}/api/v1`;
      const page = await app.firstWindow();
      const project = await request.post(`${api}/projects`, { headers, data: { repoPath: createRepo() } });
      expect(project.status()).toBe(201);
      const { id: projectId } = await project.json();
      const { items: workflows } = await (await request.get(`${api}/workflows`, { headers })).json();
      const workflowId = workflows.find((workflow: { key: string }) => workflow.key === 'browser_test').id;
      const queued = await request.post(`${api}/dev/fake-opencode/scripts`, {
        headers,
        data: {
          match: { title: '· 执行浏览器测试' },
          steps: [
            { type: 'callTool', name: 'browser_open', args: { url } },
            { type: 'callTool', name: 'browser_wait_for', args: { text: '开始追加记录', timeoutMs: 10000 } },
            ...Array.from({ length: 16 }, () => ({
              type: 'callTool',
              name: 'browser_wait_for',
              args: { text: '执行' },
            })),
            { type: 'callTool', name: 'browser_wait_for', args: { text: '继续追加记录', timeoutMs: 10000 } },
            ...Array.from({ length: 16 }, () => ({
              type: 'callTool',
              name: 'browser_wait_for',
              args: { text: '执行' },
            })),
            { type: 'callTool', name: 'browser_wait_for', args: { text: '开放自动操作', timeoutMs: 10000 } },
            { type: 'callTool', name: 'browser_click', args: { ref: 'e1' } },
            { type: 'callTool', name: 'browser_submit_report', args: { summary: '浏览器测试通过' } },
          ],
        },
      });
      expect(queued.ok()).toBe(true);
      const created = await request.post(`${api}/tasks`, {
        headers,
        data: {
          projectId,
          workflowId,
          requirement: '检查实时测试页面',
          browserTest: { target: url, writes: [] },
          start: false,
        },
      });
      expect(created.status()).toBe(201);
      const { id } = await created.json();
      await page.goto(`${base}/tasks/${id}?view=preview`);
      const started = await request.post(`${api}/tasks/${id}/start`, { headers, data: {} });
      expect(started.ok()).toBe(true);
      await expect(page.getByTestId('browser-test-surface')).toBeVisible();
      await expect(page.getByText('正在观看 · 由测试操作')).toBeVisible();
      const watched = await app.evaluate(async ({ BrowserWindow }) => {
        const children = BrowserWindow.getAllWindows()[0]?.contentView.children ?? [];
        const [view, shield] = children;
        if (view === undefined || !('webContents' in view) || shield === undefined || !('webContents' in shield))
          return null;
        const contents = view.webContents;
        const page = await contents.debugger.sendCommand('Runtime.evaluate', {
          expression: `(() => { const r = document.querySelector('button').getBoundingClientRect();
            return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), width: innerWidth, text: document.body.innerText }; })()`,
          returnByValue: true,
        });
        const { x, y, width, text } = page.result.value;
        shield.webContents.focus();
        shield.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        shield.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
        return { width, text, bounds: view.getBounds(), shieldBounds: shield.getBounds() };
      });
      expect(watched).toMatchObject({ width: 1280, text: expect.stringContaining('等待操作') });
      expect(watched?.bounds).toEqual(watched?.shieldBounds);
      await page.getByRole('button', { name: '保存截图' }).click();
      await expect(page.getByText('测试截图', { exact: true })).toBeVisible();
      expect(clicks).toBe(0);
      const release = (text: string) =>
        app.evaluate(async ({ BrowserWindow }, value) => {
          const view = BrowserWindow.getAllWindows()[0]?.contentView.children[0];
          if (view === undefined || !('webContents' in view)) throw new Error('No native test view');
          await view.webContents.debugger.sendCommand('Runtime.evaluate', {
            expression: `document.getElementById('gate').textContent = ${JSON.stringify(value)}`,
          });
        }, text);
      const getBounds = () =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.contentView.children[0]?.getBounds());
      const list = page.getByTestId('browser-test-action-list');
      await release('开始追加记录');
      await expect(list.getByRole('button')).toHaveCount(18);
      await list.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect(page.getByText('正在查看历史')).toBeVisible();
      await release('继续追加记录');
      await expect(list.getByRole('button')).toHaveCount(35);
      await expect(page.getByText('17 条新记录')).toBeVisible();
      await expect.poll(getBounds).toEqual(watched?.bounds);
      await page.getByRole('button', { name: '回到最新' }).click();
      await expect(page.getByText('跟随最新')).toBeVisible();
      await page.getByRole('button', { name: '有请求 1' }).click();
      await expect(list.getByRole('button')).toHaveCount(1);
      await expect(page.getByText(`GET ${url}`, { exact: false })).toBeVisible();
      await page.getByRole('button', { name: '专注观看' }).click();
      await expect(page.getByRole('complementary', { name: '操作与请求' })).toBeHidden();
      await page.getByRole('button', { name: '操作记录', exact: true }).click();
      await expect.poll(getBounds).toEqual(watched?.bounds);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(960, 900));
      await expect(page.getByRole('complementary', { name: '操作与请求' })).toBeHidden();
      await page.getByRole('button', { name: '操作记录', exact: true }).click();
      await expect(page.getByTestId('browser-test-surface')).toBeHidden();
      await expect.poll(getBounds).toBeUndefined();
      await page.getByRole('button', { name: '返回浏览器' }).click();
      await expect(page.getByTestId('browser-test-surface')).toBeVisible();
      await expect.poll(getBounds).toBeDefined();
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 900));
      await expect.poll(getBounds).toEqual(watched?.bounds);
      await release('开放自动操作');
      await expect(page.getByText('测试页签已关闭，可查看下方记录。')).toBeVisible();
      await expect(page.getByText('操作与请求', { exact: true })).toBeVisible();
      expect(clicks).toBe(1);
      const sessions = await (await request.get(`${api}/tasks/${id}/preview/sessions`, { headers })).json();
      expect(sessions.testTab).toBeUndefined();
      expect(sessions.attempts).toMatchObject([{ frames: 0, actions: 37, screenshots: ['1.jpg'] }]);
      await page.getByRole('button', { name: '全部 37' }).click();
      await expect(page.getByText('点击 · 执行', { exact: true })).toBeVisible();
    } finally {
      await app.close();
    }
  } finally {
    target.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      target.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  }
});
