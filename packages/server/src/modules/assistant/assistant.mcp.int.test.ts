import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AssistantToolName,
  AttemptKind,
  cancelAssistantCallOp,
  confirmAssistantCallOp,
  createConversationOp,
  ErrorCode,
  getProjectOp,
  getSettingsOp,
  listConfirmationsOp,
  MCP_SESSION_ARG,
  OPENCODE_ASSISTANT_AGENT,
  RoleBaseAgent,
  ServerEventType,
  sendAssistantMessageOp,
  type TranscriptPage,
  updateSettingsOp,
} from '@aw/shared';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createFakeClock } from '../../../test/helpers/clock.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';
import { addProject, workflowId } from '../../../test/helpers/tasks.ts';

let t: TestApp;
let mcp: Client;
let conversationId: string;
/** The opencode session of the conversation, as the bridge plugin injects it. */
let session: Record<string, string>;

beforeEach(async () => {
  t = await createTestApp({ clock: createFakeClock(Date.UTC(2025, 9, 9, 20, 30, 0)), timeZone: 'Asia/Shanghai' });
  mcp = await connectMcp(t.assistantMcpUrl, t.app.assistantMcpToken);
  conversationId = (await t.call(createConversationOp, {})).body.id;
  const idle = becomesIdle();
  await t.call(sendAssistantMessageOp, { id: conversationId, text: '你好', context: { page: 'home', params: {} } });
  await idle;
  const [created] = t.fake.sessions;
  if (created === undefined) throw new Error('no assistant session');
  session = { [MCP_SESSION_ARG]: created.id };
});
afterEach(async () => {
  await mcp.close();
  await t.close();
});

const becomesIdle = () =>
  waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.id === conversationId && !c.busy);

const call = (name: string, args: Record<string, unknown> = {}) => callTool(mcp, name, { ...args, ...session });

async function entityRefs(): Promise<unknown[]> {
  const res = await t.request({ method: 'GET', url: `/assistant/conversations/${conversationId}/transcript` });
  const page: TranscriptPage = JSON.parse(res.body);
  return page.entries.flatMap((e) => (e.kind === 'entity_ref' ? [e.data] : []));
}

/** Confirms (or cancels) and waits until the result reached the session as the next message. */
async function decide(confirmationId: string, decision: 'confirm' | 'cancel', alwaysAllow?: boolean) {
  const delivered = waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.busy);
  const res =
    decision === 'confirm'
      ? await t.call(confirmAssistantCallOp, { id: confirmationId, ...(alwaysAllow ? { alwaysAllow } : {}) })
      : await t.call(cancelAssistantCallOp, { id: confirmationId });
  if (res.status === 200) await delivered;
  return res;
}

describe('助手 MCP（/mcp/assistant，A-04）', () => {
  it('令牌与执行 MCP 分开：执行 MCP 的令牌被拒绝（401）', async () => {
    await expect(connectMcp(t.assistantMcpUrl, t.app.mcpToken)).rejects.toMatchObject({ code: 401 });
  });

  it('工具由操作清单生成并按界面模式过滤；凭据与 D65 的字段不在 schema 中，需要凭据的操作没有工具', async () => {
    const names = async () => (await mcp.listTools()).tools.map((tool) => tool.name);
    const simple = await names();
    expect(simple).toEqual(
      expect.arrayContaining(['projects_list', 'tasks_create', 'tasks_deliver', 'settings_update', 'inbox_resolve']),
    );
    expect(simple).toEqual(expect.arrayContaining(Object.values(AssistantToolName)));
    expect(simple).not.toEqual(expect.arrayContaining(['git_status']));
    for (const name of simple) expect(name).not.toMatch(/^assistant_|^debug_/);
    expect(simple).not.toContain('databases_create');
    expect(simple).not.toContain('projects_setHosting');

    await t.call(updateSettingsOp, { 'ui.mode': 'pro' });
    const { tools } = await mcp.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['git_status', 'databases_update']));
    const schemas = JSON.stringify(tools.map((tool) => tool.inputSchema));
    expect(schemas).not.toMatch(/"(password|token)"/);
    const settings = Object.keys(tools.find((tool) => tool.name === 'settings_update')?.inputSchema.properties ?? {});
    expect(settings).toContain('ui.theme');
    for (const omitted of [
      'assistant.alwaysAllow',
      'opencode.binaryPath',
      'ai.bashPolicy',
      'worktree.rootDir',
      'browser.sites',
    ]) {
      expect(settings).not.toContain(omitted);
    }
    expect(JSON.stringify(tools)).not.toContain(MCP_SESSION_ARG);
  });

  it('read：直接执行并返回结果', async () => {
    const { project } = await addProject(t);
    const { isError, body } = await call('projects_list');
    expect(isError).toBe(false);
    expect(body).toMatchObject({ items: [{ id: project.id, name: project.name }] });
  });

  it('「这周用了多少」：insights_summary 是 read，直接返回本周用了多少 tokens（19 §4）', async () => {
    const { isError, body } = await call('insights_summary', { period: 'week' });
    expect(isError).toBe(false);
    // The fake clock is Friday 2025-10-10 in Shanghai: the week started on Monday.
    expect(body).toMatchObject({
      period: { period: 'week', from: '2025-10-06', to: '2025-10-10', timeZone: 'Asia/Shanghai' },
      usage: { attempts: 0, tokensInput: 0, tokensOutput: 0 },
      attention: { interruptions: 0 },
    });
  });

  it('write：返回 needs_confirmation；确认后操作生效，结果作为下一条消息发回同一会话', async () => {
    const { project } = await addProject(t);
    const { body } = await call('projects_update', { id: project.id, name: '订单服务' });
    expect(body).toMatchObject({ status: 'needs_confirmation', confirmation_id: expect.any(String) });
    expect((await t.call(getProjectOp, { id: project.id })).body.name).toBe(project.name);
    const [card] = (await t.call(listConfirmationsOp, { id: conversationId })).body.items;
    expect(card).toMatchObject({
      operationId: 'projects.update',
      risk: 'write',
      status: 'pending',
      input: { id: project.id, name: '订单服务' },
    });

    const res = await decide(String(body.confirmation_id), 'confirm');
    expect(res.body).toMatchObject({ status: 'confirmed', result: { ok: true, output: { name: '订单服务' } } });
    expect((await t.call(getProjectOp, { id: project.id })).body.name).toBe('订单服务');
    const last = t.fake.prompts.at(-1);
    expect(last?.sessionId).toBe(session[MCP_SESSION_ARG]);
    expect(last?.text).toContain('The user confirmed `projects_update`');
    expect(last?.text).toContain('"name": "订单服务"');
    // A second click cannot run it again.
    expect((await t.call(confirmAssistantCallOp, { id: String(body.confirmation_id) })).status).toBe(409);
  });

  it('write：在卡片上选「总是允许」后，同一操作直接执行', async () => {
    const { project } = await addProject(t);
    const first = await call('projects_update', { id: project.id, name: 'A' });
    await decide(String(first.body.confirmation_id), 'confirm', true);
    expect((await t.call(getSettingsOp, {})).body['assistant.alwaysAllow']).toEqual(['projects.update']);

    const second = await call('projects_update', { id: project.id, name: 'B' });
    expect(second.body).toMatchObject({ name: 'B' });
    expect((await t.call(listConfirmationsOp, { id: conversationId })).body.items).toHaveLength(1);
  });

  it('确认后执行「开始任务」：消息流出现指向该任务的 entity_ref（D66）', async () => {
    const { project } = await addProject(t);
    const { body } = await call('tasks_create', {
      projectId: project.id,
      workflowId: await workflowId(t, 'bugfix'),
      requirement: '订单时间显示错了',
      start: false,
    });
    expect(await entityRefs()).toEqual([]);
    const res = await decide(String(body.confirmation_id), 'confirm');
    const output = res.body.result?.ok === true ? res.body.result.output : undefined;
    expect(output).toMatchObject({ key: 'T-1', title: '订单时间显示错了' });
    expect(await entityRefs()).toEqual([
      { kind: 'task', id: (output as { id: string }).id, title: 'T-1 · 订单时间显示错了' },
    ]);
  });

  it('确认后执行「批量任务」：批次与子任务已创建，消息流出现指向该批次的 entity_ref（20 §8）', async () => {
    const { project } = await addProject(t, { checkCommand: null });
    const { body } = await call('batches_create', {
      projectId: project.id,
      workflowId: await workflowId(t, 'code_review'),
      requirementTemplate: '审查 {{target}}',
      targets: ['src/'],
    });
    expect(body).toMatchObject({ status: 'needs_confirmation' });
    // The batch's task runs once confirmed; it is let finish so that nothing works on while the app closes.
    t.fake.enqueue(script().callTool('submit_result', { summary: 'Fine' }), { title: '· 代码审查' });
    const review = waitForEvent(t.app.events, ServerEventType.TaskUpdated, (task) => task.status === 'review');
    const res = await decide(String(body.confirmation_id), 'confirm');
    const output = res.body.result?.ok === true ? res.body.result.output : undefined;
    expect(output).toMatchObject({ key: 'B-1', title: '审查 {{target}}', items: [{ target: 'src/' }] });
    expect(await entityRefs()).toEqual([
      { kind: 'batch', id: (output as { id: string }).id, title: 'B-1 · 审查 {{target}}' },
    ]);
    await review;
    await t.fake.settled();
  });

  it('确认后执行「定时任务」：定时任务已创建，消息流出现指向它的 entity_ref（22 §10）', async () => {
    const { project } = await addProject(t);
    const { body } = await call('schedules_create', {
      projectId: project.id,
      workflowKey: 'code_review',
      requirement: '每晚审查订单模块',
      frequency: { kind: 'weekly', weekdays: [1, 2, 3, 4, 5], time: '02:00' },
    });
    expect(body).toMatchObject({ status: 'needs_confirmation' });

    const res = await decide(String(body.confirmation_id), 'confirm');

    const output = res.body.result?.ok === true ? res.body.result.output : undefined;
    expect(output).toMatchObject({ title: '每晚审查订单模块', status: 'active', workflow: { key: 'code_review' } });
    expect(await entityRefs()).toEqual([
      { kind: 'schedule', id: (output as { id: string }).id, title: '每晚审查订单模块' },
    ]);
  });

  it('直接执行（总是允许）的路径同样记下产出的对象；失败的调用不记', async () => {
    await t.call(updateSettingsOp, { 'assistant.alwaysAllow': ['projects.create'] });
    const repo = await createTestRepo();
    const { body } = await call('projects_create', { repoPath: repo.path, name: '库存服务' });
    expect(body).toMatchObject({ name: '库存服务' });
    expect(await call('projects_create', { repoPath: repo.path })).toMatchObject({ isError: true });
    expect(await entityRefs()).toEqual([{ kind: 'project', id: body.id, title: '库存服务' }]);
  });

  it('critical：不能设为总是允许，即使在总是允许列表中也每次确认', async () => {
    const { project } = await addProject(t);
    const first = await call('projects_delete', { id: project.id });
    expect(first.body).toMatchObject({ status: 'needs_confirmation' });
    const refused = await t.call(confirmAssistantCallOp, { id: String(first.body.confirmation_id), alwaysAllow: true });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: { code: ErrorCode.ValidationFailed } });

    await t.call(updateSettingsOp, { 'assistant.alwaysAllow': ['projects.delete'] });
    const second = await call('projects_delete', { id: project.id });
    expect(second.body).toMatchObject({ status: 'needs_confirmation' });
    expect((await t.call(getProjectOp, { id: project.id })).status).toBe(200);
  });

  it('取消：操作不执行，会话收到「用户取消了该操作」', async () => {
    const { project } = await addProject(t);
    const { body } = await call('projects_delete', { id: project.id });
    const res = await decide(String(body.confirmation_id), 'cancel');
    expect(res.body).toMatchObject({ status: 'cancelled', result: null });
    expect((await t.call(getProjectOp, { id: project.id })).status).toBe(200);
    expect(t.fake.prompts.at(-1)?.text).toContain('The user declined `projects_delete`');
  });

  it('会话还在回复时确认：结果在本轮结束后送达', async () => {
    const { project } = await addProject(t);
    t.fake.enqueue(
      script().callAppTool('projects_update', { id: project.id, name: 'C' }).requestPermission('bash', ['ls ..']),
      { agent: OPENCODE_ASSISTANT_AGENT },
    );
    const asked = waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.pendingPermissions.length > 0);
    await t.call(sendAssistantMessageOp, {
      id: conversationId,
      text: '改名为 C',
      context: { page: 'home', params: {} },
    });
    const [request] = (await asked).pendingPermissions;
    const [card] = (await t.call(listConfirmationsOp, { id: conversationId })).body.items;
    if (request === undefined || card === undefined) throw new Error('missing permission or confirmation');

    const prompts = t.fake.prompts.length;
    await t.call(confirmAssistantCallOp, { id: card.id });
    expect(t.fake.prompts).toHaveLength(prompts);

    const delivered = waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.busy);
    await t.app.services.assistant.replyPermission(conversationId, request.permissionId, 'reject');
    await delivered;
    expect(t.fake.prompts.at(-1)?.text).toContain('The user confirmed `projects_update`');
  });

  it('opencode 不可用时确认的结果随下一条消息送达；那次发送失败时结果仍保留到下一次', async () => {
    const { project } = await addProject(t);
    const { body } = await call('projects_update', { id: project.id, name: 'D' });
    t.fake.crash();
    await t.call(confirmAssistantCallOp, { id: String(body.confirmation_id) });
    t.fake.reconnect();
    const prompts = t.fake.prompts.length;

    t.fake.failNextPrompt();
    const failed = await t.call(sendAssistantMessageOp, {
      id: conversationId,
      text: '改好了吗？',
      context: { page: 'home', params: {} },
    });
    expect(failed.body).toMatchObject({ error: { code: ErrorCode.OpencodeRequestFailed } });

    const idle = becomesIdle();
    await t.call(sendAssistantMessageOp, {
      id: conversationId,
      text: '改好了吗？',
      context: { page: 'home', params: {} },
    });
    await idle;
    expect(t.fake.prompts).toHaveLength(prompts + 1);
    expect(t.fake.prompts.at(-1)?.text).toContain('The user confirmed `projects_update`');
    expect(t.fake.prompts.at(-1)?.text).toContain('改好了吗？');
  });

  it('不属于助手对话的会话（如执行任务的会话）调用返回 MCP_CONVERSATION_UNRESOLVED', async () => {
    t.fake.enqueue(script().hang());
    const repo = await createTestRepo();
    const attempt = await t.app.services.attempts.start({
      kind: AttemptKind.Execute,
      agent: RoleBaseAgent.Executor,
      taskId: null,
      projectId: null,
      nodeId: null,
      roleId: null,
      directory: repo.path,
      title: 'T-1 · exec',
      model: null,
      prompt: 'hello',
    });
    for (const args of [{}, { [MCP_SESSION_ARG]: attempt.opencodeSessionId }]) {
      const { isError, body } = await callTool(mcp, 'projects_list', args);
      expect(isError).toBe(true);
      expect(body).toMatchObject({ code: ErrorCode.McpConversationUnresolved, hint: expect.any(String) });
    }
  });

  it('简单模式下调用专业模式的操作返回 MCP_TOOL_NOT_ALLOWED', async () => {
    const { project } = await addProject(t);
    const { isError, body } = await call('git_status', { id: project.id });
    expect(isError).toBe(true);
    expect(body).toMatchObject({ code: ErrorCode.McpToolNotAllowed });
  });

  it('凭据与 D65 的字段传了也被拒绝（VALIDATION_FAILED）', async () => {
    await t.call(updateSettingsOp, { 'ui.mode': 'pro' });
    for (const [name, args] of [
      ['databases_update', { id: 'c1', password: 'secret' }],
      ['settings_update', { 'assistant.alwaysAllow': ['projects.delete'] }],
      ['settings_update', { 'opencode.binaryPath': '/tmp/evil' }],
      ['settings_update', { 'ai.bashPolicy': 'auto' }],
      ['settings_update', { 'worktree.rootDir': '/tmp/elsewhere' }],
    ] as const) {
      const { isError, body } = await call(name, args);
      expect(isError).toBe(true);
      expect(body).toMatchObject({ code: ErrorCode.ValidationFailed });
    }
    expect((await t.call(getSettingsOp, {})).body).toMatchObject({
      'assistant.alwaysAllow': [],
      'opencode.binaryPath': null,
      'worktree.rootDir': null,
    });
  });
});

describe('助手专用工具（A-05）', () => {
  it('get_current_time：用户所在时区的日期、时间与星期', async () => {
    const { body } = await call(AssistantToolName.GetCurrentTime);
    expect(body).toEqual({
      now: '2025-10-10T04:30:00+08:00',
      date: '2025-10-10',
      weekday: 'Friday',
      timeZone: 'Asia/Shanghai',
      utcOffset: '+08:00',
    });
  });

  it('get_app_status：运行环境、模式与各项数量', async () => {
    await addProject(t);
    const { body } = await call(AssistantToolName.GetAppStatus);
    expect(body).toMatchObject({ uiMode: 'simple', projects: 1, activeTasks: 0, blockingInbox: 0 });
  });

  it('open_page：推送跳转事件；缺少页面需要的参数时 VALIDATION_FAILED', async () => {
    const navigated = waitForEvent(t.app.events, ServerEventType.AssistantNavigate);
    expect((await call(AssistantToolName.OpenPage, { page: 'inbox' })).body).toEqual({ opened: true });
    expect(await navigated).toEqual({ conversationId, target: { page: 'inbox', params: {} } });

    const { isError, body } = await call(AssistantToolName.OpenPage, { page: 'task' });
    expect(isError).toBe(true);
    expect(body).toMatchObject({ code: ErrorCode.ValidationFailed });
  });

  it('open_form：预填非敏感字段；预填密码被拒绝', async () => {
    const opened = waitForEvent(t.app.events, ServerEventType.AssistantOpenForm);
    const values = { name: 'shop', host: '127.0.0.1', port: 3306, database: 'shop', username: 'app' };
    await call(AssistantToolName.OpenForm, { form: 'databases.create', values });
    expect(await opened).toEqual({ conversationId, form: 'databases.create', values });

    const { isError, body } = await call(AssistantToolName.OpenForm, {
      form: 'databases.create',
      values: { ...values, password: 'secret' },
    });
    expect(isError).toBe(true);
    expect(body).toMatchObject({ code: ErrorCode.ValidationFailed });
  });

  it('list_files / reveal_file：只限本对话的文件目录', async () => {
    const dir = join(t.dataDir, 'assistant', 'files', conversationId);
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'a.md'), 'a');
    writeFileSync(join(t.dataDir, 'assistant', 'outside.md'), 'x');

    expect((await call(AssistantToolName.ListFiles)).body).toEqual({
      files: [{ path: join('docs', 'a.md'), size: 1, modifiedAt: expect.any(Number) }],
    });
    const revealed = waitForEvent(t.app.events, ServerEventType.AssistantRevealFile);
    await call(AssistantToolName.RevealFile, { path: 'docs/a.md' });
    expect(await revealed).toEqual({ conversationId, absolutePath: join(dir, 'docs', 'a.md') });

    for (const path of ['../../outside.md', '/etc/hosts', 'missing.md']) {
      const { isError, body } = await call(AssistantToolName.RevealFile, { path });
      expect(isError).toBe(true);
      expect(body).toMatchObject({ code: ErrorCode.ValidationFailed });
    }
  });
});
