import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  AppError,
  confirmAssistantCallOp,
  createConversationOp,
  deleteProjectOp,
  ErrorCode,
  getConversationOp,
  getProjectOp,
  listConfirmationsOp,
  MCP_SESSION_ARG,
  sendAssistantMessageOp,
  updateProjectOp,
} from '@aw/shared';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';
import { addProject } from '../../../test/helpers/tasks.ts';

let t: TestApp | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await t?.close();
});
const HOME = { page: 'home', params: {} } as const;

it('同一新对话的并发首条消息只能创建一个会话，另一条应拒绝为 busy', async () => {
  t = await createTestApp();
  const app = t;
  const c = (await app.call(createConversationOp, {})).body;
  const entered = Promise.withResolvers<void>();
  const enteredAgain = Promise.withResolvers<void>();
  let entries = 0;
  const release = Promise.withResolvers<void>();
  const original = app.fake.createSession.bind(app.fake);
  vi.spyOn(app.fake, 'createSession').mockImplementation(async (input) => {
    entries += 1;
    if (entries === 1) entered.resolve();
    else enteredAgain.resolve();
    await release.promise;
    return original(input);
  });
  const first = app.call(sendAssistantMessageOp, { id: c.id, text: '窗口 A', context: HOME });
  await entered.promise;
  const second = app.call(sendAssistantMessageOp, { id: c.id, text: '窗口 B', context: HOME });
  // 第二个请求进入外部调用或被拒绝后才放行，不依赖事件循环调度时长。
  await Promise.race([enteredAgain.promise, second]);
  release.resolve();
  const results = await Promise.all([first, second]);
  await app.fake.settled();
  expect({ statuses: results.map((r) => r.status).sort(), sessions: app.fake.sessions.length }).toEqual({
    statuses: [200, 409],
    sessions: 1,
  });
});

it('确认无返回值的删除操作后，接口、卡片列表与模型都收到成功结果', async () => {
  t = await createTestApp();
  const app = t;
  const { project } = await addProject(app);
  const c = (await app.call(createConversationOp, {})).body;
  await app.call(sendAssistantMessageOp, { id: c.id, text: '删除项目', context: HOME });
  await app.fake.settled();
  const mcp = await connectMcp(app.assistantMcpUrl, app.app.assistantMcpToken);
  try {
    const { body } = await callTool(mcp, 'projects_delete', {
      id: project.id,
      [MCP_SESSION_ARG]: app.fake.sessions[0]?.id,
    });
    const confirmed = await app.call(confirmAssistantCallOp, { id: String(body.confirmation_id) });
    const gone = await app.call(getProjectOp, { id: project.id });
    const cards = await app.call(listConfirmationsOp, { id: c.id });
    expect({
      confirmStatus: confirmed.status,
      confirmBody: confirmed.body,
      projectStatus: gone.status,
      cardsStatus: cards.status,
      cardsBody: cards.body,
    }).toMatchObject({
      confirmStatus: 200,
      projectStatus: 404,
      cardsStatus: 200,
      cardsBody: { items: [{ result: { ok: true, output: null } }] },
    });
    expect(app.fake.prompts.at(-1)?.text).toContain('The user confirmed `projects_delete`');
    expect(app.fake.prompts.at(-1)?.text).toContain('"output": null');
  } finally {
    await mcp.close();
  }
  // 模拟旧版已落盘的 { ok: true }，升级后仍能读取整组确认卡。
  await app.fake.settled();
  await app.close();
  const raw = new DatabaseSync(join(app.dataDir, 'app.db'));
  try {
    raw.prepare('UPDATE assistant_confirmations SET result = ? WHERE conversation_id = ?').run('{"ok":true}', c.id);
  } finally {
    raw.close();
  }
  t = await createTestApp({ dataDir: app.dataDir });
  const restored = await t.call(listConfirmationsOp, { id: c.id });
  expect(restored.status).toBe(200);
  expect(restored.body.items[0]?.result).toEqual({ ok: true, output: null });
});

it('已执行且在等待回传的确认结果在后端重启后仍随下一条消息送达', async () => {
  t = await createTestApp();
  let app = t;
  const { project } = await addProject(app);
  const c = (await app.call(createConversationOp, {})).body;
  await app.call(sendAssistantMessageOp, { id: c.id, text: '改项目名', context: HOME });
  await app.fake.settled();
  const mcp = await connectMcp(app.assistantMcpUrl, app.app.assistantMcpToken);
  const { body } = await callTool(mcp, 'projects_update', {
    id: project.id,
    name: '已确认的新名称',
    [MCP_SESSION_ARG]: app.fake.sessions[0]?.id,
  });
  app.fake.crash();
  const confirmed = await app.call(confirmAssistantCallOp, { id: String(body.confirmation_id) });
  expect(confirmed.status).toBe(200);
  expect((await app.call(getProjectOp, { id: project.id })).body.name).toBe('已确认的新名称');
  await mcp.close();
  app.fake.reconnect();
  app.fake.failNextPrompt();
  const failed = await app.call(sendAssistantMessageOp, { id: c.id, text: '确认结果呢', context: HOME });
  expect(failed.raw.json()).toMatchObject({ error: { code: ErrorCode.OpencodeRequestFailed } });
  await app.call(updateProjectOp, { id: project.id, name: '用户后来改的名称' });
  const dataDir = app.dataDir;
  const fake = app.fake;
  await app.close();
  t = await createTestApp({ dataDir, fake });
  app = t;
  await app.call(sendAssistantMessageOp, { id: c.id, text: '继续', context: HOME });
  await app.fake.settled();
  expect(app.fake.prompts.at(-1)?.text).toContain('The user confirmed `projects_update`');
  expect(app.fake.prompts.at(-1)?.text).toContain('已确认的新名称');
  expect((await app.call(getProjectOp, { id: project.id })).body.name).toBe('用户后来改的名称');
  await app.call(sendAssistantMessageOp, { id: c.id, text: '下一轮', context: HOME });
  await app.fake.settled();
  expect(app.fake.prompts.at(-1)?.text).toBe('下一轮');
});

it('创建会话失败后释放发送权，用户下一条消息可以正常开始', async () => {
  t = await createTestApp();
  const app = t;
  const c = (await app.call(createConversationOp, {})).body;
  vi.spyOn(app.fake, 'createSession').mockRejectedValueOnce(new AppError(ErrorCode.OpencodeRequestFailed));
  const failed = await app.call(sendAssistantMessageOp, { id: c.id, text: '第一次', context: HOME });
  expect(failed.raw.json()).toMatchObject({ error: { code: ErrorCode.OpencodeRequestFailed } });
  expect((await app.call(getConversationOp, { id: c.id })).body.busy).toBe(false);
  expect((await app.call(sendAssistantMessageOp, { id: c.id, text: '第二次', context: HOME })).status).toBe(200);
  await app.fake.settled();
  expect(app.fake.sessions).toHaveLength(1);
  expect(app.fake.prompts.map((p) => p.text)).toEqual(['第二次']);
});

it('空闲事件早于发送响应时，用户消息仍被拒绝，新入队结果随后按序送达且不重复', async () => {
  t = await createTestApp();
  const app = t;
  const c = (await app.call(createConversationOp, {})).body;
  await app.call(sendAssistantMessageOp, { id: c.id, text: '开始', context: HOME });
  await app.fake.settled();
  const idleBeforeResponse = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const original = app.fake.prompt.bind(app.fake);
  vi.spyOn(app.fake, 'prompt').mockImplementationOnce(async (input) => {
    await original(input);
    await app.fake.settled();
    idleBeforeResponse.resolve();
    await release.promise;
  });
  const first = app.app.services.assistant.deliver(c.id, '结果一');
  await idleBeforeResponse.promise;
  try {
    await app.app.services.assistant.deliver(c.id, '结果二');
    const competing = await app.call(sendAssistantMessageOp, { id: c.id, text: '插入消息', context: HOME });
    expect(competing.status).toBe(409);
    expect(competing.raw.json()).toMatchObject({ error: { code: ErrorCode.AssistantBusy } });
    expect((await app.call(getConversationOp, { id: c.id })).body.busy).toBe(true);
  } finally {
    release.resolve();
    await first;
  }
  await app.fake.settled();
  expect(app.fake.prompts.map((p) => p.text)).toEqual(['开始', '结果一', '结果二']);
  expect((await app.call(getConversationOp, { id: c.id })).body.busy).toBe(false);
});

it('确认期间原页面对象被删除，不应影响已经成功执行的操作回传', async () => {
  t = await createTestApp();
  const app = t;
  const { project } = await addProject(app);
  const c = (await app.call(createConversationOp, {})).body;
  await app.call(sendAssistantMessageOp, {
    id: c.id,
    text: '切到专业模式',
    context: { page: 'project', params: { projectId: project.id } },
  });
  await app.fake.settled();
  const mcp = await connectMcp(app.assistantMcpUrl, app.app.assistantMcpToken);
  try {
    const { body } = await callTool(mcp, 'settings_update', {
      'ui.mode': 'pro',
      [MCP_SESSION_ARG]: app.fake.sessions[0]?.id,
    });
    expect((await app.call(deleteProjectOp, { id: project.id })).status).toBe(204);
    const confirmed = await app.call(confirmAssistantCallOp, { id: String(body.confirmation_id) });
    const cards = await app.call(listConfirmationsOp, { id: c.id });
    expect({ status: confirmed.status, body: confirmed.body, result: cards.body.items[0]?.result }).toMatchObject({
      status: 200,
      result: { ok: true },
    });
    expect(app.fake.prompts.at(-1)?.text).toContain('The user confirmed `settings_update`');
    expect(app.fake.prompts.at(-1)?.system).toContain('no longer exists');
  } finally {
    await mcp.close();
  }
});
