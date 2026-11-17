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
      await page.getByRole('button', { name: '接管测试页签' }).click();
      await expect(page.getByTestId('case-handoff-surface')).toBeVisible();
      const count = () =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.contentView.children.length);
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
      await expect(page.getByText('步骤 1 · 检查登录结果 · 通过')).toBeVisible();
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
