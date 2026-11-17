import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import {
  AttemptStatus,
  BROWSER_TEST_WORKFLOW_KEY,
  type BrowserCaseInput,
  type BrowserPortEvent,
  cancelTaskOp,
  clearSiteLoginOp,
  closeUserTabOp,
  createBrowserCaseOp,
  createTaskOp,
  ErrorCode,
  getTaskOp,
  listBrowserCasesOp,
  listPreviewSessionsOp,
  listSiteLoginsOp,
  navigateUserTabOp,
  openLoginTabOp,
  openUserTabOp,
  rerunBrowserCaseOp,
  resumeBrowserCaseOp,
  runBrowserCaseOp,
  ServerEventType,
  type SiteAccess,
  setUserViewportOp,
  startTaskOp,
  takeBrowserCaseHandoffOp,
  updateBrowserCaseOp,
  updateProjectOp,
  updateSettingsOp,
} from '@aw/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, createTask, nodeReaches, taskReaches, workflowId } from '../../../test/helpers/tasks.ts';
import type { BrowserHost } from './browser.host.ts';
import type { BrowserOwner } from './browser.service.ts';
import { createChromiumHost } from './host.chromium.ts';

const ORDERS = readFileSync(new URL('../../../test/fixtures/browser/orders.html', import.meta.url), 'utf8');
const page = (body: string) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;
const PAGES: Record<string, string> = {
  '/orders': ORDERS,
  '/case-test': page(`<input id="name"><button id="save" onclick="saveEntry()">保存</button><p id="status">draft</p>
    <script>
    async function saveEntry() {
      const reply = await fetch('/api/case-save?trace=private', { method: 'POST', body: document.querySelector('#name').value });
      if (reply.ok) document.querySelector('#status').textContent = 'saved';
    }
    </script>`),
  '/cover': page(`<button type="button" onclick="document.title = 'clicked'">Go</button>
    <div id="overlay" style="position: fixed; inset: 0; background: #0003"></div>
    <script>setTimeout(() => overlay.remove(), 400)</script>`),
  '/covered': page(`<button type="button">Go</button>
    <div id="overlay" class="modal-backdrop" style="position: fixed; inset: 0"></div>`),
  '/below-fold': page(`<div style="height: 1600px">Spacer</div>
    <button type="button" onclick="document.title = 'clicked'">Go</button>
    <div style="height: 800px"></div>`),
  '/form': page(`<input aria-label="first" id="a" value="old"> <input aria-label="second" id="b">
    <button type="button" onclick="out.textContent = a.value + '|' + b.value">Show</button><p id="out"></p>`),
  '/confirm':
    page(`<button type="button" onclick="out.textContent = confirm('确定删除？') ? 'deleted' : 'kept'">Delete</button>
    <p id="out"></p>`),
  '/popup': page(`<button type="button" onclick="window.open('/orders')">Open</button>`),
  // Leaves the moment the click's settle starts watching its DOM: the navigation starts after that check reached this
  // document, on every run (a page navigating itself shortly after an action, made deterministic).
  '/leave': page(`<button type="button" onclick="leaveWhenWatched()">Save</button><script>
    function leaveWhenWatched() {
      const observe = MutationObserver.prototype.observe;
      MutationObserver.prototype.observe = function (...args) {
        observe.apply(this, args);
        location.href = '/orders';
      };
    }</script>`),
  '/scoped': page(`<button type="button" onclick="Promise.allSettled([
    fetch('/api/write', { method: 'POST' }),
    fetch('/api/other', { method: 'POST' }),
    fetch('/api/write', { method: 'DELETE' })
  ]).then(() => document.title = 'checked')">Check</button>`),
  '/write': page(`<button type="button" onclick="fetch('/api/write', { method: 'POST' })">Save</button>`),
  '/search': page(`<button type="button" onclick="fetch('/api/search', { method: 'POST', body: 'q=T-1' })
      .then(() => fetch('/api/write', { method: 'POST' }))">Search</button>`),
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
    // A wiki behind HTTP authentication: nothing in its address or page says login (29 §5.4).
    if (req.url === '/wiki') {
      res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'www-authenticate': 'Basic realm="wiki"' });
      res.end(page('<p>Unauthorized</p>'));
      return;
    }
    if (req.url === '/api/case-save?trace=private') {
      res.writeHead(201).end();
      return;
    }
    if (req.url === '/case-handoff') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(
        req.headers.cookie?.includes('caseSession=ok') === true
          ? page('<form action="/case-gate" method="post"><button id="publish">发布</button></form>')
          : page(
              '<form action="/case-session" method="post"><input type="password" name="pw"><button>登录</button></form>',
            ),
      );
      return;
    }
    if (req.url === '/case-session' && req.method === 'POST') {
      res.writeHead(303, { location: '/case-handoff', 'set-cookie': 'caseSession=ok; HttpOnly; Path=/' }).end();
      return;
    }
    if (req.url === '/case-gate' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        page(
          '<form action="/case-verify" method="post"><input autocomplete="one-time-code" name="otp"><button>验证</button></form>',
        ),
      );
      return;
    }
    if (req.url === '/case-verify' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page('<p id="status">已发布</p>'));
      return;
    }
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
  writes.length = 0;
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

describe('浏览器测试流程', () => {
  it('在同一页签接管登录和验证码，从失败前的动作继续并在结束后释放登录状态', async () => {
    await browserFor();
    const { project } = await addProject(t);
    const projectId = project.id;
    const created = await t.call(createBrowserCaseOp, {
      projectId,
      definition: {
        name: '带登录的发布',
        scope: { target: `${origin}/case-handoff`, writes: [{ method: 'POST', path: '/case-gate' }] },
        steps: [
          {
            title: '发布',
            action: { kind: 'click', selector: '#publish' },
            expect: { kind: 'text', selector: '#status', value: '已发布' },
          },
        ],
      },
    });
    const run = { projectId, caseId: created.body.caseId, revision: 1, approved: true } as const;
    const waiting = () => nodeReaches(t, BROWSER_TEST_WORKFLOW_KEY, 'waiting_input');
    const loginWait = waiting();
    const started = await t.call(runBrowserCaseOp, run);
    const { id } = started.body;
    await loginWait;
    const handoff = async () => {
      const state = (await t.call(getTaskOp, { id })).body.browserCaseHandoff;
      if (state === undefined) throw new Error('Expected a browser handoff');
      return state;
    };
    const login = await handoff();
    expect(login).toMatchObject({ step: 0, reason: 'login', active: false });
    expect(writes).toEqual([]);
    const access = { id, handoffId: login.id };
    expect((await t.call(resumeBrowserCaseOp, access)).status).toBe(409);
    expect((await t.call(takeBrowserCaseHandoffOp, access)).status).toBe(204);
    expect((await t.call(resumeBrowserCaseOp, access)).status).toBe(409);
    const enter = async (tabId: string, path: string, selector: string, value: string) => {
      await host.request({
        kind: 'cdp',
        tabId,
        method: 'Runtime.evaluate',
        params: {
          expression: `document.querySelector(${JSON.stringify(selector)}).value = ${JSON.stringify(value)}; document.forms[0].requestSubmit()`,
        },
      });
      await expect
        .poll(async () => {
          const result = await host.request({
            kind: 'cdp',
            tabId,
            method: 'Runtime.evaluate',
            params: {
              expression: `location.pathname === ${JSON.stringify(path)} && document.querySelector(${JSON.stringify(selector)}) === null`,
              returnByValue: true,
            },
          });
          return result;
        })
        .toMatchObject({ result: { value: true } });
    };
    const verificationWait = waiting();
    await enter(login.tabId, '/case-handoff', 'input[type=password]', 'placeholder');
    expect((await t.call(resumeBrowserCaseOp, access)).status).toBe(204);
    await verificationWait;
    const verification = await handoff();
    expect(verification).toMatchObject({ step: 1, reason: 'verification', tabId: login.tabId });
    const verifyAccess = { id, handoffId: verification.id };
    expect((await t.call(takeBrowserCaseHandoffOp, verifyAccess)).status).toBe(204);
    await enter(login.tabId, '/case-verify', 'input[autocomplete=one-time-code]', '000000');
    const reviewed = taskReaches(t, 'review');
    expect((await t.call(resumeBrowserCaseOp, verifyAccess)).status).toBe(204);
    await reviewed;
    const finished = (await t.call(getTaskOp, { id })).body;
    expect(finished.browserCaseHandoff).toBeUndefined();
    expect(finished.result?.browserCaseReport).toMatchObject({ outcome: 'passed' });
    expect(JSON.stringify(finished.result?.browserCaseReport)).not.toMatch(
      /case-session|case-verify|000000|placeholder/,
    );
    expect(writes).toEqual(['POST /case-session', 'POST /case-gate', 'POST /case-verify']);
    await expect(host.request({ kind: 'cdp', tabId: login.tabId, method: 'Runtime.evaluate' })).rejects.toThrow(
      'No browser tab',
    );

    const freshLoginWait = waiting();
    const fresh = await t.call(runBrowserCaseOp, run);
    await freshLoginWait;
    const freshState = (await t.call(getTaskOp, { id: fresh.body.id })).body.browserCaseHandoff;
    expect(freshState).toMatchObject({ step: 0, reason: 'login', active: false });
    if (freshState === undefined) throw new Error('Expected a fresh login');
    expect(freshState.tabId).not.toBe(login.tabId);
    expect((await t.call(takeBrowserCaseHandoffOp, { id: fresh.body.id, handoffId: freshState.id })).status).toBe(204);
    await enter(freshState.tabId, '/case-handoff', 'input[type=password]', 'placeholder');
    await t.call(cancelTaskOp, { id: fresh.body.id });
    expect((await t.call(getTaskOp, { id: fresh.body.id })).body.browserCaseHandoff).toBeUndefined();
    await expect(host.request({ kind: 'cdp', tabId: freshState.tabId, method: 'Runtime.evaluate' })).rejects.toThrow(
      'No browser tab',
    );
  });

  it('保存、编辑并复跑固定用例；断言失败时保存同一步骤的截图和请求', async () => {
    await browserFor();
    const { project } = await addProject(t);
    const projectId = project.id;
    const definition: BrowserCaseInput = {
      name: '保存订单',
      scope: { target: `${origin}/case-test`, writes: [{ method: 'POST', path: '/api/case-save' }] },
      steps: [
        {
          title: '填写订单',
          action: { kind: 'fill', selector: '#name', value: 'test order' },
          expect: { kind: 'value', selector: '#name', value: 'test order' },
        },
        {
          title: '提交订单',
          action: { kind: 'click', selector: '#save' },
          expect: { kind: 'text', selector: '#status', value: 'published' },
        },
        {
          title: '再次点击',
          action: { kind: 'click', selector: '#save' },
          expect: { kind: 'path', value: '/case-test' },
        },
      ],
    };
    const created = await t.call(createBrowserCaseOp, { projectId, definition });
    expect(created.status).toBe(201);
    const { caseId, revision } = created.body;
    const run = { projectId, caseId, revision, approved: true } as const;
    t.fake.crash();
    const reviewed = taskReaches(t, 'review');
    const started = await t.call(runBrowserCaseOp, run);
    expect(started.status).toBe(201);
    await reviewed;
    const first = (await t.call(getTaskOp, { id: started.body.id })).body;
    const report = first.result?.browserCaseReport;
    expect(report).toMatchObject({
      outcome: 'failed',
      steps: [
        { step: 0, outcome: 'passed' },
        { step: 1, outcome: 'passed', actual: 'test order' },
        {
          step: 2,
          outcome: 'failed',
          actual: 'saved',
          screenshot: '1.jpg',
          requests: [{ method: 'POST', status: 201, url: `${origin}/api/case-save` }],
        },
      ],
    });
    expect(writes).toEqual(['POST /api/case-save?trace=private']);
    expect(t.fake.sessions).toHaveLength(0);
    if (report === undefined) throw new Error('Expected test report');
    const file = await readFile(t.app.services.browser.attemptFile(report.attemptId, '1.jpg'));
    expect(file.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));

    const updated = await t.call(updateBrowserCaseOp, {
      projectId,
      caseId,
      revision,
      definition: {
        ...definition,
        steps: [
          {
            title: '查看初始状态',
            action: { kind: 'check' },
            expect: { kind: 'text', selector: '#status', value: 'draft' },
          },
        ],
      },
    });
    expect(updated.body.revision).toBe(2);
    expect((await t.call(listBrowserCasesOp, { projectId })).body.items).toEqual([updated.body]);
    expect((await t.call(runBrowserCaseOp, run)).status).toBe(409);
    expect((await t.call(updateBrowserCaseOp, { projectId, caseId, revision, definition })).status).toBe(409);
    const nextReview = taskReaches(t, 'review');
    const next = await t.call(runBrowserCaseOp, { ...run, revision: 2 });
    await nextReview;
    expect((await t.call(getTaskOp, { id: next.body.id })).body.result?.browserCaseReport?.outcome).toBe('passed');

    const blockedCase = await t.call(updateBrowserCaseOp, {
      projectId,
      caseId,
      revision: 2,
      definition: {
        ...definition,
        scope: { ...definition.scope, writes: [] },
        steps: [
          {
            title: '提交超出授权的请求',
            action: { kind: 'click', selector: '#save' },
            expect: { kind: 'visible', selector: '#status' },
          },
        ],
      },
    });
    expect(blockedCase.status).toBe(200);
    const blockedReview = taskReaches(t, 'review');
    const blocked = await t.call(runBrowserCaseOp, { ...run, revision: 3 });
    expect(blocked.status).toBe(201);
    await blockedReview;
    expect((await t.call(getTaskOp, { id: blocked.body.id })).body.result?.browserCaseReport).toMatchObject({
      outcome: 'blocked',
      steps: [
        { step: 0, outcome: 'passed' },
        {
          step: 1,
          outcome: 'blocked',
          screenshot: '1.jpg',
          requests: expect.arrayContaining([
            { method: 'POST', url: `${origin}/api/case-save`, blocked: 'read_only', status: null, failed: true },
          ]),
        },
      ],
    });
    expect(writes).toEqual(['POST /api/case-save?trace=private']);

    const replayReview = taskReaches(t, 'review');
    const replay = await t.call(rerunBrowserCaseOp, { id: first.id, approved: true });
    expect(replay.body.id).not.toBe(first.id);
    expect(replay.body.browserCase).toEqual(first.browserCase);
    await replayReview;
    expect((await t.call(getTaskOp, { id: replay.body.id })).body.result?.browserCaseReport?.outcome).toBe('failed');
    expect(writes).toEqual(['POST /api/case-save?trace=private', 'POST /api/case-save?trace=private']);
  });

  it('保存显式授权，执行允许的写入并拦截其他方法和路径，报告可取回截图', async () => {
    await browserFor();
    const { project } = await addProject(t, { checkCommand: null });
    const input = {
      projectId: project.id,
      workflowId: await workflowId(t, BROWSER_TEST_WORKFLOW_KEY),
      requirement: '检查写入授权',
      start: false,
    };
    expect((await t.call(createTaskOp, input)).status).toBe(400);
    const browserTest = {
      target: `${origin}/scoped`,
      writes: [{ method: 'POST' as const, path: '/api/write' }],
    };
    const created = await t.call(createTaskOp, { ...input, browserTest });
    expect(created.status).toBe(201);
    const { id } = created.body;
    expect((await t.call(getTaskOp, { id })).body.browserTest).toEqual(browserTest);
    const report = taskReaches(t, 'review');
    t.fake.enqueue(
      script()
        .callTool('get_task_context', {})
        .callTool('browser_open', { url: browserTest.target })
        .callTool('browser_click', { ref: 'e1' })
        .callTool('browser_screenshot', {})
        .callTool('submit_result', { summary: '已执行测试用例，见 1.jpg' }),
      { title: '· 执行浏览器测试' },
    );
    await t.call(startTaskOp, { id });
    await report;
    await t.fake.settled();
    expect(writes).toEqual(['POST /api/write']);
    expect((await t.call(getTaskOp, { id })).body.result?.summary).toContain('1.jpg');
    expect((await t.call(listPreviewSessionsOp, { id })).body.attempts).toMatchObject([{ screenshots: ['1.jpg'] }]);
  });
});

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
    // HTTP authentication the AI's tab cannot answer: the document is a 401.
    await expect(browser.open(owner, `${origin}/wiki`)).rejects.toMatchObject({
      code: ErrorCode.BrowserLoginRequired,
      details: { url: `${origin}/wiki` },
    });
    await expect(browser.readUrl(`${origin}/wiki`)).rejects.toMatchObject({
      code: ErrorCode.BrowserLoginRequired,
      details: { url: `${origin}/wiki` },
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

  it('定位并点开首屏下方的按钮，检查和截图也能读取该元素', async () => {
    const { browser, owner } = await browserFor();
    const opened = await browser.open(owner, `${origin}/below-fold`);
    const ref = refOf(opened.page, 'button "Go"');
    expect(await browser.inspect(owner, ref)).toMatchObject({ inViewport: false, coveredBy: null });
    expect((await browser.screenshot(owner, { ref, fullPage: false })).data).not.toBe('');
    const clicked = await browser.click(owner, ref);
    expect(clicked.title).toBe('clicked');
    const clickedRef = refOf(clicked.page, 'button "Go"');
    expect(await browser.inspect(owner, clickedRef)).toMatchObject({ inViewport: true, coveredBy: null });
    expect((await browser.screenshot(owner, { ref: clickedRef, fullPage: false })).data).not.toBe('');
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

  it('等页面稳定时动作引起的导航才提交：等新页面稳定，结果是新页面', async () => {
    const { browser, owner } = await browserFor();
    const opened = await browser.open(owner, `${origin}/leave`);
    const saved = await browser.click(owner, refOf(opened.page, 'button "Save"'));
    expect(saved).toMatchObject({ navigated: true, settled: true, url: `${origin}/orders`, title: '退款单' });
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

  it('只读网站规则写明的查询路径：AI 用 POST 查询照常，同一网站别的写请求仍拦下', async () => {
    const { browser, owner } = await browserFor('read');
    await t.call(updateSettingsOp, {
      'browser.sites': [{ pattern: '127.0.0.1', access: 'read', queryPaths: ['/api/search'] }],
    });
    const opened = await browser.open(owner, `${origin}/search`);
    const searched = await browser.click(owner, refOf(opened.page, 'button "Search"'));
    expect(searched.blockedWrites).toEqual(['POST /api/write']);
    expect(writes).toContain('POST /api/search');
    expect(writes).not.toContain('POST /api/write');
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
          queuePosition: null,
          startedAt: 0,
          endedAt: 0,
        },
      },
    });
    await expect(browser.snapshot(owner)).rejects.toMatchObject({ code: ErrorCode.ValidationFailed });
  });
});

/** The Chromium host, and a way to report a tab gone as main does when the app's page starts over (29 §8.1). */
function reportingGone(inner: BrowserHost) {
  const listeners = new Set<(event: BrowserPortEvent) => void>();
  const wrapped: BrowserHost = {
    request: (op) => inner.request(op),
    onEvent(listener) {
      listeners.add(listener);
      const off = inner.onEvent(listener);
      return () => {
        listeners.delete(listener);
        off();
      };
    },
  };
  const gone = (tabId: string) => {
    for (const listener of listeners) listener({ type: 'browser.gone', tabId, reason: 'the app page started over' });
  };
  return { host: wrapped, gone };
}

describe('浏览器：用户自己的预览标签页（29 §8.1）', () => {
  it('打开任务预览的首个关键页面，切换路径与尺寸，地址与当前页面的错误数随事件更新；关闭或页面重新加载后不能再用', async () => {
    const reporting = reportingGone(host);
    t = await createTestApp({ browserHost: reporting.host });
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
    // What a change request of the user carries along with their feedback (29 §2.3).
    const note = t.app.services.browser.pageNote(task.id, opened.tabId);
    expect(note).toContain('looking at /broken of the preview (desktop, 1280×800)');
    expect(note).toContain('- boom');
    expect(note).toMatch(/- GET http:\/\/127\.0\.0\.1:\d+\/missing\.png → 404/);
    expect(() => t.app.services.browser.pageNote('another-task', opened.tabId)).toThrow(
      expect.objectContaining({ code: ErrorCode.ValidationFailed }),
    );
    // Errors count per page: back on a clean page they start over.
    const clean = tabUpdated((s) => s.url.endsWith('/orders'));
    await t.call(navigateUserTabOp, { tabId: opened.tabId, path: '/orders' });
    expect(await clean).toMatchObject({ consoleErrors: 0, failedRequests: 0 });

    const mobile = tabUpdated((s) => s.viewport === 'mobile');
    await t.call(setUserViewportOp, { tabId: opened.tabId, preset: 'mobile' });
    await mobile;

    expect((await t.call(closeUserTabOp, { tabId: opened.tabId })).status).toBe(204);
    expect((await t.call(navigateUserTabOp, { tabId: opened.tabId, path: '/orders' })).status).toBe(404);

    // Main closed it because the app's page started over: the backend lets go of it as well.
    const { body: again } = await t.call(openUserTabOp, { taskId: task.id });
    reporting.gone(again.tabId);
    expect((await t.call(navigateUserTabOp, { tabId: again.tabId, path: '/orders' })).status).toBe(404);
  });
});
