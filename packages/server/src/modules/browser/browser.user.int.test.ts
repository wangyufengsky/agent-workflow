import { randomUUID } from 'node:crypto';
import {
  bindAssistantPreviewOp,
  cancelTaskOp,
  closeUserTabOp,
  createConversationOp,
  ErrorCode,
  MCP_SESSION_ARG,
  navigatePreviewTabOp,
  openPreviewTabOp,
  sendAssistantMessageOp,
  setPreviewViewportOp,
  startPreviewOp,
  stopPreviewOp,
  updateProjectOp,
} from '@aw/shared';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';
import { addProject, createTask, taskReaches } from '../../../test/helpers/tasks.ts';
import { createChromiumHost } from './host.chromium.ts';

let t: TestApp;
let host: ReturnType<typeof createChromiumHost>;
let mcp: Client;
let projectId: string;
let conversationId: string;
let session: string;
beforeEach(async () => {
  host = createChromiumHost();
  t = await createTestApp({ browserHost: host });
  mcp = await connectMcp(t.assistantMcpUrl, t.app.assistantMcpToken);
  conversationId = (await t.call(createConversationOp, {})).body.id;
  await t.call(sendAssistantMessageOp, { id: conversationId, text: '看看预览', context: { page: 'home', params: {} } });
  await t.fake.settled();
  const created = t.fake.sessions[0];
  if (created === undefined) throw new Error('Expected assistant session');
  session = created.id;
  const { project } = await addProject(t, {
    files: {
      'server.mjs': `import { createServer } from 'node:http';
createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8');
res.end('<title>用户预览</title><h1>' + req.url + '</h1>');
}).listen(Number(process.env.PORT), '127.0.0.1');`,
    },
  });
  projectId = project.id;
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
});
afterEach(async () => {
  await mcp.close();
  await t.close();
  await host.close();
});

async function task() {
  const reviewing = taskReaches(t, 'plan_review');
  const task = await createTask(t, { projectId, workflow: 'bugfix', checkpoints: { confirm_plan: true } });
  await reviewing;
  return task;
}
const read = (args: Record<string, unknown> = {}) =>
  callTool(mcp, 'browser_read', { ...args, [MCP_SESSION_ARG]: session });
const bind = (taskId: string, tabId: string) =>
  t.call(bindAssistantPreviewOp, { id: conversationId, preview: { taskId, tabId } });

describe('用户当前预览与助手归属', () => {
  it('两个用户预览和 AI 页面严格隔离，模型不能自己传标签页；读取返回实际路径、视口和文字', async () => {
    expect(await read()).toMatchObject({ isError: true, body: { code: ErrorCode.BrowserNotOpen } });
    const a = await task();
    const b = await task();
    const tabA = (await t.call(openPreviewTabOp, { taskId: a.id })).body.tabId;
    const tabB = (await t.call(openPreviewTabOp, { taskId: b.id })).body.tabId;
    await t.call(navigatePreviewTabOp, { tabId: tabA, path: '/user-a' });
    await t.call(navigatePreviewTabOp, { tabId: tabB, path: '/user-b' });
    const owner = { id: randomUUID(), taskId: a.id, projectId, filesDir: t.dataDir };
    await t.app.services.browser.open(owner, '/ai-owned');
    expect((await bind(a.id, `${owner.id}:preview`)).body).toMatchObject({ error: { code: ErrorCode.BrowserNotOpen } });
    expect((await bind(b.id, tabA)).body).toMatchObject({ error: { code: ErrorCode.BrowserNotOpen } });
    expect((await bind(a.id, tabA)).status).toBe(204);
    await t.call(setPreviewViewportOp, { tabId: tabA, preset: 'mobile' });
    expect((await t.call(openPreviewTabOp, { taskId: a.id })).body).toEqual({ tabId: tabA, viewport: 'mobile' });
    const current = await read();
    expect(current).toMatchObject({
      isError: false,
      body: { taskId: a.id, viewport: 'mobile', url: expect.stringContaining('/user-a') },
    });
    expect(current.body.page).toContain('heading "/user-a"');
    expect(await read({ tabId: tabB })).toMatchObject({ isError: true, body: { code: ErrorCode.ValidationFailed } });
    const names = (await mcp.listTools()).tools.map((tool) => tool.name);
    for (const hidden of [
      'browser_openUserTab',
      'browser_navigateUserTab',
      'browser_setUserViewport',
      'assistant_bindPreview',
    ])
      expect(names).not.toContain(hidden);
    const another = (await t.call(createConversationOp, {})).body.id;
    await expect(t.app.services.browser.readPreview(another)).rejects.toMatchObject({ code: ErrorCode.BrowserNotOpen });
  });

  it('显式取消关联、关闭页签和任务结束都会停止读取，普通用户页隐藏不改变已选关联', async () => {
    const a = await task();
    const tabId = (await t.call(openPreviewTabOp, { taskId: a.id })).body.tabId;
    await bind(a.id, tabId);
    expect((await read()).isError).toBe(false);
    // 浮层的原生 place(null) 不发送取消关联；读取仍使用同一个明确选中的页面。
    expect((await read()).body.taskId).toBe(a.id);
    const reading = t.app.services.browser.readPreview(conversationId);
    t.app.services.browser.bindPreview(conversationId, null);
    await expect(reading).rejects.toMatchObject({ code: ErrorCode.BrowserNotOpen });
    await bind(a.id, tabId);
    await t.call(bindAssistantPreviewOp, { id: conversationId, preview: null });
    expect(await read()).toMatchObject({ isError: true, body: { code: ErrorCode.BrowserNotOpen } });
    await bind(a.id, tabId);
    await t.call(closeUserTabOp, { tabId });
    expect(await read()).toMatchObject({ isError: true, body: { code: ErrorCode.BrowserNotOpen } });
    const reopened = (await t.call(openPreviewTabOp, { taskId: a.id })).body.tabId;
    await bind(a.id, reopened);
    await t.call(cancelTaskOp, { id: a.id });
    expect(await read()).toMatchObject({ isError: true, body: { code: ErrorCode.BrowserNotOpen } });
  });

  it('停止的预览不可读，重开跟随新端口；用户地址栏拒绝离开任务来源', async () => {
    const a = await task();
    const { tabId } = (await t.call(openPreviewTabOp, { taskId: a.id })).body;
    await bind(a.id, tabId);
    await t.call(stopPreviewOp, { taskId: a.id });
    expect(await read()).toMatchObject({ isError: true, body: { code: ErrorCode.BrowserNotOpen } });
    // 服务可由助手先启动；用户回来打开时仍要追到新来源，不能沿用已经停掉的旧地址。
    const restarted = (await t.call(startPreviewOp, { taskId: a.id })).body;
    expect((await t.call(openPreviewTabOp, { taskId: a.id })).body.tabId).toBe(tabId);
    expect(await read()).toMatchObject({ isError: true, body: { code: ErrorCode.BrowserNotOpen } });
    await bind(a.id, tabId);
    expect((await read()).body).toMatchObject({ title: '用户预览', url: `${restarted.url}/` });
    for (const path of ['//other.example/', '/\\other.example/']) {
      const response = await t.call(navigatePreviewTabOp, { tabId, path });
      expect(response.body).toMatchObject({ error: { code: ErrorCode.ValidationFailed } });
    }
  });
});
