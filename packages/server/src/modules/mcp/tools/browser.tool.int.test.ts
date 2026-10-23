import { createServer, type Server } from 'node:http';
import {
  AttemptKind,
  askKnowledgeOp,
  BROWSER_FRAME_WIDTH,
  type BrowserFrame,
  ErrorCode,
  listBrowserFramesOp,
  listMcpToolsOp,
  MCP_SESSION_ARG,
  McpToolName,
  RoleBaseAgent,
  ServerEventType,
  updateSettingsOp,
} from '@aw/shared';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../../test/helpers/app.ts';
import { createChromiumHost } from '../../../../test/helpers/browser.ts';
import { waitForEvent } from '../../../../test/helpers/events.ts';
import { createTestRepo } from '../../../../test/helpers/git.ts';
import { callTool, connectMcp } from '../../../../test/helpers/mcp.ts';
import { addProject } from '../../../../test/helpers/tasks.ts';

// The browser tools over the execution MCP (12 §6, 29 §6), as opencode calls them for an attempt's session; the tabs
// run in a real Chromium.

const PAGE = `<!doctype html><html><head><title>工单</title></head><body>
<h1>工单</h1>
<label>标题 <input id="subject"></label>
<label>优先级 <select id="priority"><option>低</option><option>高</option></select></label>
<button type="button" onclick="out.textContent = subject.value + '/' + priority.value">保存</button>
<p id="out"></p>
<script>console.error('boom')</script>
</body></html>`;

let server: Server;
let origin: string;
let host: ReturnType<typeof createChromiumHost>;
let t: TestApp;
let mcp: Client;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(req.url === '/other' ? '<!doctype html><title>别处</title><p>别处</p>' : PAGE);
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
beforeEach(async () => {
  t = await createTestApp({ browserHost: host });
  await t.call(updateSettingsOp, { 'browser.sites': [{ pattern: '127.0.0.1', access: 'interact' }] });
  mcp = await connectMcp(t.mcpUrl, t.app.mcpToken);
});
afterEach(async () => {
  await mcp.close();
  await t.close();
});

/** An attempt of `kind` whose session keeps working; its tools are called with its session id. */
async function sessionOf(kind: AttemptKind) {
  t.fake.enqueue(script().hang());
  const repo = await createTestRepo();
  const attempt = await t.app.services.attempts.start({
    kind,
    agent: RoleBaseAgent.Executor,
    taskId: null,
    projectId: null,
    nodeId: null,
    roleId: null,
    directory: repo.path,
    title: 'T-1 · browser',
    model: null,
    prompt: 'hello',
  });
  const session = attempt.opencodeSessionId;
  if (session === null) throw new Error('attempt has no session');
  const call = (name: McpToolName, args: Record<string, unknown> = {}) =>
    callTool(mcp, name, { [MCP_SESSION_ARG]: session, ...args });
  return Object.assign(call, { session });
}

/** The width in a JPEG's start-of-frame segment (baseline or progressive). */
function jpegWidth(jpeg: Buffer): number {
  let at = 2;
  while (at < jpeg.length) {
    const marker = jpeg[at + 1];
    if (marker === 0xc0 || marker === 0xc2) return jpeg.readUInt16BE(at + 7);
    at += 2 + jpeg.readUInt16BE(at + 2);
  }
  throw new Error('No start-of-frame segment');
}

const refIn = (page: unknown, element: string) => {
  const match = new RegExp(`${element}[^\\n]*\\[ref=(e\\d+)\\]`).exec(String(page));
  if (match?.[1] === undefined) throw new Error(`No ${element} in ${String(page)}`);
  return match[1];
};

describe('浏览器工具', () => {
  it('执行尝试用全部工具操作一个网站页面', async () => {
    const call = await sessionOf(AttemptKind.Execute);
    const opened = await call(McpToolName.BrowserOpen, { url: `${origin}/` });
    expect(opened).toMatchObject({ isError: false, body: { tab: 'site', title: '工单', newErrors: { console: 1 } } });
    const page = opened.body.page;

    const snapshot = await call(McpToolName.BrowserSnapshot);
    expect(snapshot.body.page).toContain('heading "工单" [level=1]');
    await call(McpToolName.BrowserType, { ref: refIn(page, 'textbox "标题"'), text: '打印机坏了' });
    await call(McpToolName.BrowserSelect, { ref: refIn(page, 'combobox "优先级"'), values: ['高'] });
    const saved = await call(McpToolName.BrowserClick, { ref: refIn(page, 'button "保存"') });
    expect(saved.body.page).toContain('"打印机坏了/高"');

    await call(McpToolName.BrowserType, { ref: refIn(page, 'textbox "标题"'), text: 'x' });
    expect((await call(McpToolName.BrowserPress, { key: 'Escape' })).isError).toBe(false);
    const waited = await call(McpToolName.BrowserWaitFor, { text: '打印机坏了/高', timeoutMs: 2000 });
    expect(waited.body.met).toBe(true);
    const inspected = await call(McpToolName.BrowserInspect, { ref: refIn(page, 'button "保存"') });
    expect(inspected.body).toMatchObject({ text: '保存', inViewport: true, coveredBy: null });
    const logs = await call(McpToolName.BrowserLogs, { since: 'open' });
    expect(logs.body).toMatchObject({ console: [{ level: 'error', text: 'boom' }] });
    const mobile = await call(McpToolName.BrowserViewport, { preset: 'mobile' });
    expect(mobile.body.page).toMatch(/^页面 \/ · 工单 · mobile 390×844/);

    const shot = await mcp.callTool({
      name: McpToolName.BrowserScreenshot,
      arguments: { [MCP_SESSION_ARG]: call.session },
    });
    expect(shot.content).toMatchObject([
      { type: 'text', text: '{"file":"1.jpg"}' },
      { type: 'image', mimeType: 'image/jpeg', data: expect.stringMatching(/^\/9j\//) },
    ]);
  });

  it('改变页面的动作各留一张缩小的画面：随事件推送、可按尝试列出与读取，没有任务的尝试也可以（29 §8.2）', async () => {
    const call = await sessionOf(AttemptKind.Execute);
    const pushed: BrowserFrame[] = [];
    const off = t.app.events.subscribe((e) => {
      if (e.type === ServerEventType.BrowserFrame) pushed.push(e.data);
    });
    const opened = await call(McpToolName.BrowserOpen, { url: `${origin}/` });
    await call(McpToolName.BrowserSnapshot);
    await call(McpToolName.BrowserClick, { ref: refIn(opened.body.page, 'button "保存"') });
    off();

    const attemptId = pushed[0]?.attemptId ?? '';
    const { body } = await t.call(listBrowserFramesOp, { attemptId });
    expect(body.items).toEqual(pushed);
    expect(body.items).toMatchObject([
      { taskId: null, seq: 1, tool: McpToolName.BrowserOpen, url: `${origin}/`, file: 'f1.jpg' },
      { seq: 2, tool: McpToolName.BrowserClick, file: 'f2.jpg' },
    ]);
    const image = await t.request({ method: 'GET', url: `/attempts/${attemptId}/browser/f2.jpg` });
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(jpegWidth(image.rawPayload)).toBe(BROWSER_FRAME_WIDTH);
    for (const file of ['frames.jsonl', '..%2Ff1.jpg']) {
      expect((await t.request({ method: 'GET', url: `/attempts/${attemptId}/browser/${file}` })).statusCode).toBe(404);
    }
  });

  it('没打开页面、地址不允许、编号作废时各自返回错误码与提示', async () => {
    const call = await sessionOf(AttemptKind.Execute);
    expect((await call(McpToolName.BrowserSnapshot)).body).toMatchObject({
      code: ErrorCode.ValidationFailed,
      hint: expect.stringContaining('browser_open'),
    });
    const elsewhere = await call(McpToolName.BrowserOpen, { url: origin.replace('127.0.0.1', 'localhost') });
    expect(elsewhere.body).toMatchObject({
      code: ErrorCode.BrowserSiteNotAllowed,
      hint: expect.stringContaining('rules'),
    });

    const opened = await call(McpToolName.BrowserOpen, { url: `${origin}/` });
    await call(McpToolName.BrowserOpen, { url: `${origin}/other` });
    const stale = await call(McpToolName.BrowserClick, { ref: refIn(opened.body.page, 'button "保存"') });
    expect(stale.body).toMatchObject({
      code: ErrorCode.BrowserRefStale,
      hint: expect.stringContaining('browser_snapshot'),
    });
  });

  it('规划只能打开网站；不允许浏览器的尝试类型 MCP_TOOL_NOT_ALLOWED；工具页列出允许的类型', async () => {
    const plan = await sessionOf(AttemptKind.Plan);
    expect((await plan(McpToolName.BrowserOpen, { url: '/orders' })).body).toMatchObject({
      code: ErrorCode.McpToolNotAllowed,
    });
    expect((await plan(McpToolName.BrowserOpen, { url: `${origin}/` })).isError).toBe(false);

    const commit = await sessionOf(AttemptKind.CommitMessage);
    expect((await commit(McpToolName.BrowserOpen, { url: `${origin}/` })).body).toMatchObject({
      code: ErrorCode.McpToolNotAllowed,
    });
    const { items } = (await t.call(listMcpToolsOp, {})).body;
    expect(items.find((tool) => tool.name === McpToolName.BrowserOpen)?.allowedKinds).toEqual([
      'plan',
      'execute',
      'review',
      'research',
    ]);
  });

  it('知识问答只在打开网络开关时可以用浏览器', async () => {
    const { project } = await addProject(t);
    const ask = async (web: boolean) => {
      const ended = waitForEvent(
        t.app.events,
        ServerEventType.AttemptUpdated,
        (d) => d.attempt.kind === 'research' && d.attempt.status !== 'running' && d.attempt.status !== 'starting',
      );
      t.fake.enqueue(
        script()
          .callTool(McpToolName.BrowserOpen, { url: `${origin}/` })
          .callTool(McpToolName.SubmitAnswer, { answer: 'no', citations: [] }),
        { agent: 'aw-researcher' },
      );
      await t.call(askKnowledgeOp, {
        projectId: project.id,
        question: 'q',
        sources: { code: true, docs: false, database: false, web },
      });
      await ended;
      return t.fake.toolCalls.filter((c) => c.name === McpToolName.BrowserOpen).at(-1);
    };

    expect(await ask(false)).toMatchObject({ isError: true, result: { code: ErrorCode.McpToolNotAllowed } });
    expect(await ask(true)).toMatchObject({ isError: false, result: { tab: 'site', title: '工单' } });
  });
});
