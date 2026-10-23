import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import {
  AttemptStatus,
  clearSiteLoginOp,
  closeUserTabOp,
  ErrorCode,
  listSiteLoginsOp,
  navigateUserTabOp,
  openLoginTabOp,
  openUserTabOp,
  ServerEventType,
  type SiteAccess,
  setUserViewportOp,
  updateProjectOp,
  updateSettingsOp,
} from '@aw/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, createTask, taskReaches } from '../../../test/helpers/tasks.ts';
import type { BrowserOwner } from './browser.service.ts';
import { createChromiumHost } from './host.chromium.ts';

const ORDERS = readFileSync(new URL('../../../test/fixtures/browser/orders.html', import.meta.url), 'utf8');
const page = (body: string) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;
const PAGES: Record<string, string> = {
  '/orders': ORDERS,
  '/cover': page(`<button type="button" onclick="document.title = 'clicked'">Go</button>
    <div id="overlay" style="position: fixed; inset: 0; background: #0003"></div>
    <script>setTimeout(() => overlay.remove(), 400)</script>`),
  '/covered': page(`<button type="button">Go</button>
    <div id="overlay" class="modal-backdrop" style="position: fixed; inset: 0"></div>`),
  '/form': page(`<input aria-label="first" id="a" value="old"> <input aria-label="second" id="b">
    <button type="button" onclick="out.textContent = a.value + '|' + b.value">Show</button><p id="out"></p>`),
  '/confirm':
    page(`<button type="button" onclick="out.textContent = confirm('确定删除？') ? 'deleted' : 'kept'">Delete</button>
    <p id="out"></p>`),
  '/popup': page(`<button type="button" onclick="window.open('/orders')">Open</button>`),
  '/write': page(`<button type="button" onclick="fetch('/api/write', { method: 'POST' })">Save</button>`),
  '/login': page('<form><input aria-label="user"> <input type="password" aria-label="password"></form>'),
  '/account': page('<form><input aria-label="user"> <input type="password" aria-label="password"></form>'),
  '/errors': page(`<script>console.error('boom')</script><script src="/missing.js"></script>
    <script>throw new Error('kaput')</script>`),
  '/delayed': page(`<script>setTimeout(() => {
      const p = document.createElement('p'); p.textContent = '加载完成'; document.body.append(p);
    }, 300)</script>`),
};

let server: Server;
let origin: string;
const writes: string[] = [];
let host: ReturnType<typeof createChromiumHost>;
let t: TestApp;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method !== 'GET') writes.push(`${req.method} ${req.url}`);
    // A website's login: the session cookie it sets.
    if (req.url === '/sign-in') res.setHeader('set-cookie', 'sid=s3cret; Path=/; HttpOnly');
    const body = req.url === '/sign-in' ? page('<p>已登录</p>') : PAGES[req.url ?? ''];
    res.writeHead(body === undefined ? 404 : 200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body ?? 'not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP address');
  origin = `http://127.0.0.1:${address.port}`;
  host = createChromiumHost();
});
afterAll(async () => {
  await host.close();
  server.close();
});
afterEach(async () => t.close());

/** An app whose website rules allow the test server; the owner stands for a knowledge question's attempt. */
async function browserFor(access: SiteAccess = 'interact') {
  t = await createTestApp({ browserHost: host });
  await t.call(updateSettingsOp, { 'browser.sites': [{ pattern: '127.0.0.1', access }] });
  const owner: BrowserOwner = {
    id: randomUUID(),
    taskId: null,
    projectId: null,
    filesDir: join(t.dataDir, 'runs', 'knowledge'),
  };
  return { browser: t.app.services.browser, owner };
}

function refOf(snapshot: string, element: string): string {
  const match = new RegExp(`${element.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*\\[ref=(e\\d+)\\]`).exec(snapshot);
  if (match?.[1] === undefined) throw new Error(`No ${element} in:\n${snapshot}`);
  return match[1];
}

describe('浏览器：打开与读取页面', () => {
  it('打开网站返回带编号的页面结构与页头', async () => {
    const { browser, owner } = await browserFor();
    const opened = await browser.open(owner, `${origin}/orders`);
    expect(opened).toMatchObject({ tab: 'site', title: '退款单', settled: true, navigated: true, blockedWrites: [] });
    expect(opened.page.split('\n')[0]).toBe('页面 /orders · 退款单 · desktop 1280×800 · 控制台错误 0 · 失败请求 0');
    expect(opened.page).toContain('button "导出" [ref=e4]');
  });

  it('不在网站规则里的地址 BROWSER_SITE_NOT_ALLOWED；需要登录的网站 BROWSER_LOGIN_REQUIRED', async () => {
    const { browser, owner } = await browserFor();
    const elsewhere = origin.replace('127.0.0.1', 'localhost');
    await expect(browser.open(owner, `${elsewhere}/orders`)).rejects.toMatchObject({
      code: ErrorCode.BrowserSiteNotAllowed,
    });
    await expect(browser.open(owner, `${origin}/login`)).rejects.toMatchObject({
      code: ErrorCode.BrowserLoginRequired,
      details: { url: `${origin}/login` },
    });
    // No login word in the address: a form with one password field is a login page too.
    await expect(browser.open(owner, `${origin}/account`)).rejects.toMatchObject({
      code: ErrorCode.BrowserLoginRequired,
    });
  });

  it('控制台错误、未捕获异常与失败的请求进日志，并计入页头与动作结果', async () => {
    const { browser, owner } = await browserFor();
    const opened = await browser.open(owner, `${origin}/errors`);
    expect(opened.newErrors).toEqual({ console: 1, exceptions: 1, requests: 1 });
    const logs = browser.logs(owner, 'last');
    expect(logs.console).toMatchObject([{ level: 'error', text: 'boom' }]);
    expect(logs.exceptions).toMatchObject([{ message: expect.stringContaining('kaput') }]);
    expect(logs.requests).toMatchObject([{ url: `${origin}/missing.js`, status: 404, resourceType: 'Script' }]);
    expect(browser.logs(owner, 'last')).toEqual({ console: [], exceptions: [], requests: [] });
  });

  it('等文字出现：页面稍后加上的内容', async () => {
    const { browser, owner } = await browserFor();
    await browser.open(owner, `${origin}/delayed`);
    const waited = await browser.waitFor(owner, { text: '加载完成', gone: false, timeoutMs: 5000 });
    expect(waited.met).toBe(true);
    expect(waited.page).toContain('"加载完成"');
  });
});

describe('浏览器：动作层', () => {
  it('被弹层挡住的按钮等弹层消失后再点', async () => {
    const { browser, owner } = await browserFor();
    const opened = await browser.open(owner, `${origin}/cover`);
    const clicked = await browser.click(owner, refOf(opened.page, 'button "Go"'));
    expect(clicked.title).toBe('clicked');
  });

  it('一直被挡住时 BROWSER_ACTION_FAILED，说明挡住它的元素', async () => {
    const { browser, owner } = await browserFor();
    const opened = await browser.open(owner, `${origin}/covered`);
    await expect(browser.click(owner, refOf(opened.page, 'button "Go"'))).rejects.toMatchObject({
      code: ErrorCode.BrowserActionFailed,
      details: { reason: 'covered', coveredBy: 'div#overlay.modal-backdrop' },
    });
  });

  it('输入先聚焦目标：清空后输入第一个框、再输入第二个框，不会输到前一个框', async () => {
    const { browser, owner } = await browserFor();
    const opened = await browser.open(owner, `${origin}/form`);
    await browser.type(owner, refOf(opened.page, 'textbox "first"'), { text: 'new', clear: true, submit: false });
    await browser.type(owner, refOf(opened.page, 'textbox "second"'), { text: 'two', clear: true, submit: false });
    const shown = await browser.click(owner, refOf(opened.page, 'button "Show"'));
    expect(shown.page).toContain('"new|two"');
  });

  it('确认框自动点确定并写进结果；window.open 在同一个标签页打开', async () => {
    const { browser, owner } = await browserFor();
    const confirmPage = await browser.open(owner, `${origin}/confirm`);
    const deleted = await browser.click(owner, refOf(confirmPage.page, 'button "Delete"'));
    expect(deleted.dialog).toBe('页面弹出confirm「确定删除？」，已点确定');
    expect(deleted.page).toContain('"deleted"');

    const popup = await browser.open(owner, `${origin}/popup`);
    const opened = await browser.click(owner, refOf(popup.page, 'button "Open"'));
    expect(opened).toMatchObject({ navigated: true, url: `${origin}/orders` });
  });

  it('页面导航后旧编号作废：BROWSER_REF_STALE', async () => {
    const { browser, owner } = await browserFor();
    const first = await browser.open(owner, `${origin}/cover`);
    const old = refOf(first.page, 'button "Go"');
    await browser.open(owner, `${origin}/delayed`);
    await expect(browser.click(owner, old)).rejects.toMatchObject({ code: ErrorCode.BrowserRefStale });
  });

  it('只读网站上的写请求被拦下并写进结果，服务端没有收到', async () => {
    const { browser, owner } = await browserFor('read');
    const opened = await browser.open(owner, `${origin}/write`);
    const saved = await browser.click(owner, refOf(opened.page, 'button "Save"'));
    expect(saved.blockedWrites).toEqual(['POST /api/write']);
    expect(writes).not.toContain('POST /api/write');
    expect(browser.logs(owner, 'open').requests).toMatchObject([{ method: 'POST', blocked: 'read_only' }]);
  });

  it('截图存到尝试的目录', async () => {
    const { browser, owner } = await browserFor();
    await browser.open(owner, `${origin}/orders`);
    const shot = await browser.screenshot(owner, { fullPage: false });
    const saved = await readFile(join(owner.filesDir, 'browser', owner.id, shot.file));
    expect(saved.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });
});

describe('浏览器：网站登录', () => {
  it('在登录标签页里登录后列出该网站，退出登录后不再列出', async () => {
    await browserFor();
    const opened = await t.call(openLoginTabOp, { url: `${origin}/sign-in` });
    expect(opened.status).toBe(201);
    await t.call(closeUserTabOp, { tabId: opened.body.tabId });

    expect((await t.call(listSiteLoginsOp, {})).body.hosts).toContain('127.0.0.1');
    const cleared = await t.call(clearSiteLoginOp, { host: '127.0.0.1' });
    expect(cleared.body.hosts).not.toContain('127.0.0.1');
    expect((await t.call(listSiteLoginsOp, {})).body.hosts).not.toContain('127.0.0.1');
  });

  it('登录地址必须是 http(s)', async () => {
    await browserFor();
    expect((await t.call(openLoginTabOp, { url: 'file:///etc/passwd' })).status).toBe(400);
  });
});

describe('浏览器：任务预览与尝试结束', () => {
  it('以 / 开头的路径打开任务的页面预览；尝试结束后标签页关闭', async () => {
    t = await createTestApp({ browserHost: host });
    const { project } = await addProject(t, {
      files: {
        'server.mjs': `import { createServer } from 'node:http';
createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<title>预览</title><h1>来自 worktree</h1>');
})
  .listen(Number(process.env.PORT), '127.0.0.1', () => console.log('listening'));`,
      },
    });
    await t.call(updateProjectOp, {
      id: project.id,
      preview: { command: 'node server.mjs', setupCommand: null, readyPath: '/', pages: ['/'], extraOrigins: [] },
    });
    const reviewing = taskReaches(t, 'plan_review');
    const task = await createTask(t, {
      projectId: project.id,
      workflow: 'bugfix',
      checkpoints: { confirm_plan: true },
    });
    await reviewing;
    const owner: BrowserOwner = { id: randomUUID(), taskId: task.id, projectId: project.id, filesDir: t.dataDir };
    const browser = t.app.services.browser;

    const opened = await browser.open(owner, '/');
    expect(opened).toMatchObject({ tab: 'preview', title: '预览' });
    expect(opened.page).toContain('heading "来自 worktree" [level=1]');

    t.app.events.publish({
      type: ServerEventType.AttemptUpdated,
      data: {
        taskId: task.id,
        nodeId: null,
        attempt: {
          id: owner.id,
          taskId: task.id,
          nodeId: null,
          kind: 'execute',
          seq: 1,
          status: AttemptStatus.Succeeded,
          model: null,
          nudges: 0,
          error: null,
          progress: null,
          startedAt: 0,
          endedAt: 0,
        },
      },
    });
    await expect(browser.snapshot(owner)).rejects.toMatchObject({ code: ErrorCode.ValidationFailed });
  });
});

describe('浏览器：用户自己的预览标签页（29 §8.1）', () => {
  it('打开任务预览的首个关键页面，切换路径与尺寸，地址与当前页面的错误数随事件更新；关闭后不能再用', async () => {
    t = await createTestApp({ browserHost: host });
    const { project } = await addProject(t, {
      files: {
        'server.mjs': `import { createServer } from 'node:http';
const pages = {
  '/orders': '<title>订单</title><h1>订单</h1>',
  '/broken': '<title>坏了</title><img src="/missing.png"><script>console.error("boom")</script>',
};
createServer((req, res) => {
  const body = pages[req.url];
  res.writeHead(body === undefined ? 404 : 200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body ?? 'not found');
}).listen(Number(process.env.PORT), '127.0.0.1', () => console.log('listening'));`,
      },
    });
    await t.call(updateProjectOp, {
      id: project.id,
      preview: {
        command: 'node server.mjs',
        setupCommand: null,
        readyPath: '/orders',
        pages: ['/orders'],
        extraOrigins: [],
      },
    });
    const reviewing = taskReaches(t, 'plan_review');
    const task = await createTask(t, {
      projectId: project.id,
      workflow: 'bugfix',
      checkpoints: { confirm_plan: true },
    });
    await reviewing;
    const tabUpdated = (
      matches: (s: { url: string; consoleErrors: number; failedRequests: number; viewport: string }) => boolean,
    ) => waitForEvent(t.app.events, ServerEventType.BrowserTabUpdated, matches);

    const ordersShown = tabUpdated((s) => s.url.endsWith('/orders'));
    const { status, body: opened } = await t.call(openUserTabOp, { taskId: task.id });
    expect(status).toBe(201);
    expect(opened).toMatchObject({ taskId: task.id, viewport: 'desktop' });
    expect(await ordersShown).toMatchObject({ tabId: opened.tabId, consoleErrors: 0, failedRequests: 0 });

    const broken = tabUpdated((s) => s.url.endsWith('/broken') && s.consoleErrors === 1 && s.failedRequests === 1);
    await t.call(navigateUserTabOp, { tabId: opened.tabId, path: '/broken' });
    await broken;
    // Errors count per page: back on a clean page they start over.
    const clean = tabUpdated((s) => s.url.endsWith('/orders'));
    await t.call(navigateUserTabOp, { tabId: opened.tabId, path: '/orders' });
    expect(await clean).toMatchObject({ consoleErrors: 0, failedRequests: 0 });

    const mobile = tabUpdated((s) => s.viewport === 'mobile');
    await t.call(setUserViewportOp, { tabId: opened.tabId, preset: 'mobile' });
    await mobile;

    expect((await t.call(closeUserTabOp, { tabId: opened.tabId })).status).toBe(204);
    expect((await t.call(navigateUserTabOp, { tabId: opened.tabId, path: '/orders' })).status).toBe(404);
  });
});
