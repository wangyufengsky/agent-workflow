import { createServer, type Server } from 'node:http';
import {
  cancelAssistantCallOp,
  confirmAssistantCallOp,
  createConversationOp,
  ErrorCode,
  getPreviewOp,
  listConfirmationsOp,
  MCP_SESSION_ARG,
  openLoginTabOp,
  readWebsiteOp,
  sendAssistantMessageOp,
  updateProjectOp,
  updateSettingsOp,
  VIEWPORT_SIZES,
} from '@aw/shared';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';
import { addProject, createTask, taskReaches } from '../../../test/helpers/tasks.ts';
import { systemClock } from '../../core/clock.ts';
import { createChromiumHost } from './host.chromium.ts';

let server: Server;
let origin: string;
let host: ReturnType<typeof createChromiumHost>;
let t: TestApp;
let mcp: Client;
let conversationId: string;
let session: Record<string, string>;
const writes: string[] = [];
const readHosts: string[] = [];
const pendingTimers = new Set<() => void>();

beforeAll(async () => {
  server = createServer((req, res) => {
    readHosts.push(req.headers.host ?? '');
    if (req.method !== 'GET') writes.push(`${req.method} ${req.url}`);
    if (req.url === '/shared-worker.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(`onconnect = ({ ports: [port] }) => {
        fetch('/worker-write', { method: 'POST' }).then(
          () => port.postMessage('written'), () => port.postMessage('blocked'));
      };`);
      return;
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { location: `${origin.replace('127.0.0.1', 'localhost')}/article` });
      res.end();
      return;
    }
    const pages: Record<string, string> = {
      '/shared-worker': `<h1>共享 Worker</h1><p id="result">等待</p><script>
        const worker = new SharedWorker('/shared-worker.js');
        worker.port.onmessage = ({ data }) => { result.textContent = data; };
        worker.onerror = () => { result.textContent = 'blocked'; };
      </script>`,
      '/article': '<title>项目说明</title><h1>发布步骤</h1><p>先检查，再发布。</p>',
      '/errors': '<title>错误页</title><script>console.error("页面错误")</script><script src="/missing.js"></script>',
      '/login': '<input type="password" aria-label="密码">',
      '/sign-in': '<p>登录完成</p>',
      '/account': `<title>账号资料</title><p>${req.headers.cookie === 'sid=logged-in' ? '欢迎回来' : '未登录'}</p>
        <script>
          fetch('/write', { method: 'POST' }).catch(() => {});
          new WebSocket('ws://' + location.host + '/socket');
        </script>`,
    };
    if (req.url === '/sign-in') res.setHeader('set-cookie', 'sid=logged-in; Path=/; HttpOnly');
    const body = pages[req.url ?? ''];
    res.writeHead(body === undefined ? 404 : 200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body ?? 'not found');
  });
  server.on('upgrade', (req, socket) => {
    writes.push(`WebSocket ${req.url}`);
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP address');
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))));
beforeEach(async () => {
  writes.length = 0;
  readHosts.length = 0;
  host = createChromiumHost();
  t = await createTestApp({
    browserHost: host,
    clock: {
      now: systemClock.now,
      schedule(ms, fn) {
        const fire = () => {
          pendingTimers.delete(fire);
          fn();
        };
        pendingTimers.add(fire);
        const cancel = systemClock.schedule(ms, fire);
        return () => {
          pendingTimers.delete(fire);
          cancel();
        };
      },
    },
  });
  await t.call(updateSettingsOp, { 'browser.sites': [{ pattern: '127.0.0.1', access: 'interact' }] });
  mcp = await connectMcp(t.assistantMcpUrl, t.app.assistantMcpToken);
  conversationId = (await t.call(createConversationOp, {})).body.id;
  await t.call(sendAssistantMessageOp, {
    id: conversationId,
    text: '读取网页',
    context: { page: 'home', params: {} },
  });
  await t.fake.settled();
  const created = t.fake.sessions[0];
  if (created === undefined) throw new Error('Expected assistant session');
  session = { [MCP_SESSION_ARG]: created.id };
});
afterEach(async () => {
  await mcp.close();
  await t.close();
  await host.close();
});

const call = (name: string, args: Record<string, unknown> = {}) => callTool(mcp, name, { ...args, ...session });

describe('助手网页文字与任务预览', () => {
  it('只暴露文字读取与预览管理，读网页直接返回文字与错误日志，不产生确认卡', async () => {
    const names = (await mcp.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining(['browser_readUrl', 'previews_get', 'previews_start', 'previews_stop']),
    );
    expect(names.filter((name) => name.startsWith('browser_'))).toEqual(['browser_readUrl']);
    expect(names).not.toContain('previews_trial');

    const timersBefore = pendingTimers.size;
    const read = await call('browser_readUrl', { url: `${origin}/errors` });
    expect(pendingTimers.size).toBe(timersBefore);
    expect(read).toMatchObject({
      isError: false,
      body: {
        url: `${origin}/errors`,
        title: '错误页',
        tab: 'site',
        settled: true,
        logs: {
          console: [{ level: 'error', text: '页面错误' }],
          requests: [{ url: `${origin}/missing.js`, status: 404 }],
        },
      },
    });
    expect((await t.call(listConfirmationsOp, { id: conversationId })).body.items).toEqual([]);
  });

  it('复用用户网站登录，但在可操作网站也拦截自动 POST 和 WebSocket，读完关闭临时标签页', async () => {
    const login = await t.call(openLoginTabOp, { url: `${origin}/sign-in` });
    const targets = async () =>
      z
        .object({ targetInfos: z.array(z.object({ targetId: z.string(), type: z.string() })) })
        .parse(await host.request({ kind: 'cdp', tabId: login.body.tabId, method: 'Target.getTargets' }))
        .targetInfos.filter((target) => target.type === 'page')
        .map((target) => target.targetId)
        .sort();
    const before = await targets();

    const timersBefore = pendingTimers.size;
    const read = await t.call(readWebsiteOp, { url: `${origin}/account` });
    expect(pendingTimers.size).toBe(timersBefore);
    expect(read.status).toBe(200);
    expect(read.body.page).toContain('欢迎回来');
    expect(read.body.logs.requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'POST', url: `${origin}/write`, blocked: 'read_only' }),
      ]),
    );
    expect(writes).toEqual([]);
    expect(await targets()).toEqual(before);
  });

  it('共享 Worker 无法归属单个标签页时拒绝运行，不向只读网站写入并记录原因', async () => {
    const read = await t.call(readWebsiteOp, { url: `${origin}/shared-worker` });
    expect(read.status).toBe(200);
    expect(writes).toEqual([]);
    expect(t.logs).toEqual(
      expect.arrayContaining([expect.objectContaining({ msg: 'browser unowned worker blocked' })]),
    );
  });

  it('拒绝非法与未授权地址，登录页与导航失败显式报错；失败路径不留下标签页', async () => {
    await host.request({
      kind: 'open',
      tabId: 'observer',
      partition: 'test-observer',
      userFacing: false,
      viewport: VIEWPORT_SIZES.desktop,
      policy: { previewOrigins: [], sites: [] },
    });
    const targets = async () =>
      z
        .object({ targetInfos: z.array(z.object({ targetId: z.string(), type: z.string() })) })
        .parse(await host.request({ kind: 'cdp', tabId: 'observer', method: 'Target.getTargets' }))
        .targetInfos.filter((target) => target.type === 'page')
        .map((target) => target.targetId)
        .sort();
    const before = await targets();
    for (const [url, status, code] of [
      ['file:///etc/hosts', 400, ErrorCode.ValidationFailed],
      [origin.replace('://', '://user:password@'), 400, ErrorCode.ValidationFailed],
      [`${origin.replace('127.0.0.1', 'localhost')}/article`, 403, ErrorCode.BrowserSiteNotAllowed],
      [`${origin}/login`, 409, ErrorCode.BrowserLoginRequired],
      [`${origin}/redirect`, 502, ErrorCode.BrowserReadFailed],
    ] as const) {
      const timersBefore = pendingTimers.size;
      const read = await t.call(readWebsiteOp, { url });
      expect(pendingTimers.size).toBe(timersBefore);
      expect(read.status).toBe(status);
      expect(read.body).toMatchObject({ error: { code } });
      expect(await targets()).toEqual(before);
    }
    expect(readHosts.some((hostname) => hostname.startsWith('localhost:'))).toBe(false);
    const denied = await call('browser_readUrl', { url: `${origin}/login` });
    expect(denied).toMatchObject({
      isError: true,
      body: { code: ErrorCode.BrowserLoginRequired, hint: expect.any(String) },
    });
    await host.request({ kind: 'close', tabId: 'observer' });
  });

  it('启动和停止预览都经确认，取消不执行；总是允许后直接执行并返回真实预览状态', async () => {
    const { project } = await addProject(t, {
      files: {
        'server.mjs': `import { createServer } from 'node:http';
createServer((req, res) => res.end('<h1>任务预览</h1>')).listen(Number(process.env.PORT), '127.0.0.1');`,
      },
    });
    await t.call(updateProjectOp, {
      id: project.id,
      preview: {
        command: 'node server.mjs',
        setupCommand: null,
        readyPath: '/',
        pages: ['/'],
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
    const args = { taskId: task.id };
    const cancelled = await call('previews_start', args);
    expect(cancelled.body).toMatchObject({ status: 'needs_confirmation' });
    await t.call(cancelAssistantCallOp, { id: String(cancelled.body.confirmation_id) });
    expect((await call('previews_get', args)).body).toMatchObject({ state: 'stopped', url: null });

    const requested = await call('previews_start', args);
    const started = await t.call(confirmAssistantCallOp, {
      id: String(requested.body.confirmation_id),
      alwaysAllow: true,
    });
    expect(started.body.result).toMatchObject({
      ok: true,
      output: { state: 'running', url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:/) },
    });
    const stopped = await call('previews_stop', args);
    expect(stopped.body).toMatchObject({ status: 'needs_confirmation' });
    expect((await t.call(getPreviewOp, args)).body.state).toBe('running');
    await t.call(confirmAssistantCallOp, { id: String(stopped.body.confirmation_id) });
    expect((await call('previews_get', args)).body).toMatchObject({ state: 'stopped', url: null });
    expect((await call('previews_start', args)).body).toMatchObject({ state: 'running' });
    const missing = await call('previews_start', { taskId: 'not-a-task' });
    expect(missing).toMatchObject({ isError: true, body: { code: ErrorCode.StateTransitionInvalid } });
    await t.fake.settled();
  });
});
