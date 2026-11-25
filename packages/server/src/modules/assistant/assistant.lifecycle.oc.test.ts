import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  AssistantTurnStatus,
  abortAssistantOp,
  createAssistantContinuationOp,
  createConversationOp,
  deleteConversationOp,
  getAssistantContextOp,
  OPENCODE_ASSISTANT_AGENT,
  PermissionDecision,
  ServerEventType,
  sendAssistantMessageOp,
  setConversationPermissionModeOp,
  type TranscriptPage,
  updateSettingsOp,
} from '@aw/shared';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject } from '../../../test/helpers/tasks.ts';
import { assistantPermissionRules } from '../opencode/index.ts';

const MODEL = 'aw-assistant-scripted/model';
const TOOL_PREFIX = 'TOOL_INPUT: ';
const advertisedTools = new Set<string>();
const reviewerTools: string[][] = [];
const rejectedPermissions: string[] = [];
const continuationRequests: Array<z.infer<typeof requestSchema>['messages']> = [];
const CONTINUATION_TEST = 'VERIFY_CONTINUATION_HANDOFF';
const requestSchema = z.object({
  tools: z.array(z.object({ function: z.object({ name: z.string() }) })).default([]),
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.union([z.string(), z.array(z.object({ type: z.string(), text: z.string().optional() }))]).nullable(),
    }),
  ),
});
const callSchema = z.object({
  name: z.enum(['read', 'write', 'bash', 'skill']),
  arguments: z.record(z.string(), z.unknown()),
});

async function bodyOf(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

/** 本地模型仅指定工具调用；真实 opencode 决定文件边界，测试不替代工具或权限判断。 */
function scriptedModel(): Server {
  let recovered = false;
  return createServer((req, res) => {
    void (async () => {
      const { messages, tools } = await bodyOf(req);
      for (const tool of tools) advertisedTools.add(tool.function.name);
      const last = messages.at(-1);
      const text =
        typeof last?.content === 'string' ? last.content : (last?.content ?? []).map((p) => p.text ?? '').join('');
      if (!recovered && last?.role === 'user' && text.includes('VERIFY_ASSISTANT_OVERFLOW')) {
        recovered = true;
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message: "This model's maximum context length is 32000 tokens. Please reduce your input.",
              code: 'context_length_exceeded',
              type: 'invalid_request_error',
            },
          }),
        );
        return;
      }
      if (text.includes(CONTINUATION_TEST)) continuationRequests.push(messages);
      if (text.includes('WAIT_FOR_ABORT')) {
        res.setHeader('content-type', 'text/event-stream');
        res.flushHeaders();
        return;
      }
      const review = last?.role === 'user' && text.startsWith('{"userRequest":');
      if (review) reviewerTools.push(tools.map((tool) => tool.function.name));
      const instruction =
        !review && last?.role === 'user' && text.includes(TOOL_PREFIX)
          ? callSchema.parse(JSON.parse(text.slice(text.lastIndexOf(TOOL_PREFIX) + TOOL_PREFIX.length)))
          : undefined;
      const delta =
        instruction === undefined
          ? {
              role: 'assistant',
              content:
                review && !text.includes('MALFORMED_REVIEW')
                  ? JSON.stringify({ decision: 'once', reason: '用户要求查看工作目录。' })
                  : 'done',
            }
          : {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: `call_${randomUUID()}`,
                  type: 'function',
                  function: { name: instruction.name, arguments: JSON.stringify(instruction.arguments) },
                },
              ],
            };
      const base = { id: 'chatcmpl-lifecycle', created: 0, model: 'model', object: 'chat.completion.chunk' };
      res.setHeader('content-type', 'text/event-stream');
      res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      res.write(
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: instruction === undefined ? 'stop' : 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`,
      );
      res.end('data: [DONE]\n\n');
    })().catch((error: unknown) => res.destroy(error instanceof Error ? error : new Error(String(error))));
  });
}

let model: Server;
let t: TestApp;
beforeAll(async () => {
  model = scriptedModel();
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  const address = model.address();
  if (address === null || typeof address === 'string') throw new Error('Expected model TCP address');
  const config = join(await mkdtemp(join(tmpdir(), 'aw-assistant-oc-')), 'opencode.json');
  await writeFile(
    config,
    JSON.stringify({
      provider: {
        'aw-assistant-scripted': {
          npm: '@ai-sdk/openai-compatible',
          options: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'unused' },
          models: { model: { name: 'Scripted', tool_call: true } },
        },
      },
    }),
  );
  t = await createTestApp({ realOpencode: true, env: { ...process.env, OPENCODE_CONFIG: config } });
  await t.app.start(t.port);
  await t.call(updateSettingsOp, { 'ai.defaultModel': MODEL });
});
afterAll(async () => {
  await t.close();
  model.closeAllConnections();
  await new Promise<void>((resolve, reject) => model.close((error) => (error ? reject(error) : resolve())));
});

it('@opencode 受管助手真实超窗后在原会话压缩重发一次，抽屉显示新窗口', async () => {
  const { body: c } = await t.call(createConversationOp, {});
  const idle = waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (v) => v.id === c.id && !v.busy, 60000);
  await t.call(sendAssistantMessageOp, {
    id: c.id,
    text: 'VERIFY_ASSISTANT_OVERFLOW',
    context: { page: 'home', params: {} },
  });
  await idle;
  expect(t.app.services.assistant.get(c.id).usage.latest?.status).toBe(AssistantTurnStatus.Completed);
  const { body } = await t.call(getAssistantContextOp, { id: c.id });
  expect(body).toMatchObject({ managed: true, compactions: 1, budget: { model: MODEL } });
  expect(t.logs.filter((l) => l.msg === 'assistant context recovery continued')).toHaveLength(1);
  expect(advertisedTools.has('agent-workflow-app_recall')).toBe(true);
});

it('@opencode 续接在新模型会话发送绑定项目和旧决定，下一轮不重复添加交接', async () => {
  const { project } = await addProject(t);
  const source = (await t.call(createConversationOp, { projectId: project.id })).body;
  async function send(id: string, text: string) {
    const idle = waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.id === id && !c.busy, 60_000);
    expect((await t.call(sendAssistantMessageOp, { id, text, context: { page: 'home', params: {} } })).status).toBe(
      200,
    );
    await idle;
  }
  await send(source.id, '就按方案 B 做，后续检查任务 T-931');
  for (const text of ['处理认证', '处理集成', '处理文档']) await send(source.id, text);
  const child = (
    await t.call(createAssistantContinuationOp, { id: source.id, requestId: randomUUID(), attachmentIds: [] })
  ).body;
  await send(child.id, `${CONTINUATION_TEST} 一`);
  await send(child.id, `${CONTINUATION_TEST} 二`);

  const latest = continuationRequests.at(-2);
  expect(latest?.filter((message) => message.role === 'user')).toHaveLength(1);
  expect(JSON.stringify(latest)).toContain(project.id);
  expect(JSON.stringify(latest?.at(-1))).toContain('就按方案 B 做，后续检查任务 T-931');
  expect(JSON.stringify(continuationRequests.at(-1)?.at(-1))).not.toContain('T-931');
});

async function say(
  id: string,
  instruction: z.infer<typeof callSchema>,
  decision: PermissionDecision = PermissionDecision.Reject,
) {
  const previous = t.app.services.assistant.get(id).usage.latest?.id;
  const completion = waitForEvent(
    t.app.events,
    ServerEventType.AssistantTranscript,
    (e) => e.conversationId === id && e.entries.some((entry) => entry.kind === 'tool_result'),
    60_000,
  );
  const seen = new Set<string>();
  const replies: Promise<unknown>[] = [];
  const unsubscribe = t.app.events.subscribe((event) => {
    if (event.type !== ServerEventType.AssistantUpdated || event.data.id !== id) return;
    for (const permission of event.data.pendingPermissions) {
      if (seen.has(permission.permissionId)) continue;
      seen.add(permission.permissionId);
      if (decision === PermissionDecision.Reject) rejectedPermissions.push(permission.permission);
      replies.push(t.app.services.assistant.replyPermission(id, permission.permissionId, decision));
    }
  });
  const idle = waitForEvent(
    t.app.events,
    ServerEventType.AssistantUpdated,
    (c) => c.id === id && !c.busy && !!c.usage.latest && c.usage.latest.id !== previous,
    60_000,
  );
  const response = await t.call(sendAssistantMessageOp, {
    id,
    text: `${TOOL_PREFIX}${JSON.stringify(instruction)}`,
    context: { page: 'home', params: {} },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  await Promise.all([idle, completion]);
  unsubscribe();
  await Promise.all(replies);
  const result = await t.request({ method: 'GET', url: `/assistant/conversations/${id}/transcript` });
  return result
    .json<TranscriptPage>()
    .entries.filter((e) => e.kind === 'tool_result')
    .at(-1);
}

it('@opencode 助手可读写自己目录，不能读取或覆盖另一个对话；旧会话迁移到独立会话且可删除', async () => {
  const a = (await t.call(createConversationOp, {})).body;
  const b = (await t.call(createConversationOp, {})).body;
  // 升级前的原生目录不可原地改变；隔离升级必须淘汰它，界面历史仍保留。
  const legacyDirectory = join(await realpath(t.dataDir), 'assistant');
  await mkdir(t.app.services.assistant.filesDir(a.id), { recursive: true });
  const legacySession = await t.app.services.opencode.createSession({
    directory: legacyDirectory,
    title: 'Legacy assistant',
    agent: OPENCODE_ASSISTANT_AGENT,
    permission: assistantPermissionRules(),
  });
  const raw = new DatabaseSync(join(t.dataDir, 'app.db'));
  try {
    raw
      .prepare('UPDATE assistant_conversations SET opencode_session_id = ?, isolated = 0 WHERE id = ?')
      .run(legacySession, a.id);
  } finally {
    raw.close();
  }
  const aFile = join(t.app.services.assistant.filesDir(a.id), 'own.txt');
  const bFile = join(t.app.services.assistant.filesDir(b.id), 'private.txt');
  expect(await say(a.id, { name: 'write', arguments: { filePath: aFile, content: 'owned by A' } })).toMatchObject({
    data: { status: 'completed' },
  });
  expect(await say(b.id, { name: 'write', arguments: { filePath: bFile, content: 'private B marker' } })).toMatchObject(
    { data: { status: 'completed' } },
  );
  expect(await readFile(aFile, 'utf8')).toBe('owned by A');
  expect(await say(a.id, { name: 'read', arguments: { filePath: bFile } })).toMatchObject({
    data: { status: 'error' },
  });
  expect(await say(a.id, { name: 'write', arguments: { filePath: bFile, content: 'changed' } })).toMatchObject({
    data: { status: 'error' },
  });
  expect(await readFile(bFile, 'utf8')).toBe('private B marker');
  expect(
    await say(a.id, {
      name: 'bash',
      arguments: { command: `head -c 100 '${bFile}'`, description: 'Read another conversation' },
    }),
  ).toMatchObject({
    data: { status: 'error' },
  });
  expect(rejectedPermissions).toContain('bash');
  expect(advertisedTools).not.toContain('task');
  expect(await say(a.id, { name: 'read', arguments: { filePath: aFile } })).toMatchObject({
    data: { status: 'completed', output: expect.stringContaining('owned by A') },
  });
  const sdk = t.app.services.runtime.sdk();
  const { data: sessions } = await sdk.session.list(
    { directory: t.app.services.assistant.filesDir(b.id) },
    { throwOnError: true },
  );
  expect(sessions.some((s) => s.directory.endsWith(b.id))).toBe(true);
  const { data: aSessions } = await sdk.session.list(
    { directory: t.app.services.assistant.filesDir(a.id) },
    { throwOnError: true },
  );
  const migrated = aSessions.find((s) => s.directory.endsWith(a.id));
  expect(migrated).toBeDefined();
  const { data: legacySessions } = await sdk.session.list({ directory: legacyDirectory }, { throwOnError: true });
  expect(legacySessions.map((s) => s.id)).not.toContain(legacySession);
  expect((await t.call(deleteConversationOp, { id: a.id })).status).toBe(204);
  const { data: remaining } = await sdk.session.list(
    { directory: t.app.services.assistant.filesDir(a.id) },
    { throwOnError: true },
  );
  expect(remaining.map((s) => s.id)).not.toContain(migrated?.id);
});

it('@opencode 刚派发即停止不会漏过启动，随后短问完成；无效模型与 agent 的前置错误也会结束请求', async () => {
  const c = (await t.call(createConversationOp, {})).body;
  // 先建立原生 session，让下一次停止正好落在同步 prompt 派发与 Runner 注册之间。
  const ready = waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (d) => d.id === c.id && !d.busy);
  await t.call(sendAssistantMessageOp, { id: c.id, text: 'hello', context: { page: 'home', params: {} } });
  await ready;
  let session: string | undefined;
  const dispatched = Promise.withResolvers<void>();
  const original = t.app.services.opencode.promptAssistant.bind(t.app.services.opencode);
  vi.spyOn(t.app.services.opencode, 'promptAssistant').mockImplementationOnce((input) => {
    session = input.sessionId;
    const handle = original(input);
    dispatched.resolve();
    return handle;
  });
  const sending = t.call(sendAssistantMessageOp, {
    id: c.id,
    text: 'WAIT_FOR_ABORT',
    context: { page: 'home', params: {} },
  });
  await dispatched.promise;
  expect((await t.call(abortAssistantOp, { id: c.id })).status).toBe(200);
  await sending;
  expect(t.app.services.assistant.get(c.id)).toMatchObject({
    busy: false,
    usage: { latest: { status: AssistantTurnStatus.Aborted } },
  });
  const completed = waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (d) => d.id === c.id && !d.busy);
  await t.call(sendAssistantMessageOp, { id: c.id, text: 'answer briefly', context: { page: 'home', params: {} } });
  await completed;
  expect(t.app.services.assistant.get(c.id).usage.latest?.status).toBe(AssistantTurnStatus.Completed);
  const permission = waitForEvent(
    t.app.events,
    ServerEventType.AssistantUpdated,
    (d) => d.id === c.id && d.pendingPermissions.length > 0,
  );
  await t.call(sendAssistantMessageOp, {
    id: c.id,
    text: `${TOOL_PREFIX}${JSON.stringify({ name: 'bash', arguments: { command: 'echo permission', description: 'Permission stop regression' } })}`,
    context: { page: 'home', params: {} },
  });
  await permission;
  expect((await t.call(abortAssistantOp, { id: c.id })).status).toBe(200);
  expect(t.app.services.assistant.get(c.id)).toMatchObject({ busy: false, pendingPermissions: [] });
  if (session === undefined) throw new Error('Expected session');
  for (const invalid of ['model', 'agent']) {
    const handle = original({
      sessionId: session,
      directory: t.app.services.assistant.filesDir(c.id),
      messageId: `msg_native_${invalid}`,
      agent: invalid === 'agent' ? 'nonexistent-agent' : OPENCODE_ASSISTANT_AGENT,
      model:
        invalid === 'model'
          ? { providerId: 'nonexistent-provider', modelId: 'model' }
          : { providerId: 'aw-assistant-scripted', modelId: 'model' },
      text: 'hello',
    });
    await Promise.all([
      handle.accepted.catch(() => undefined),
      expect(handle.completed).rejects.toMatchObject({ details: { responseReceived: true } }),
    ]);
  }
  await t.call(deleteConversationOp, { id: c.id });
});

it('@opencode 助手可加载重验、需求追溯和项目约定技能', async () => {
  const { body: conversation } = await t.call(createConversationOp, {});
  const result = await say(conversation.id, { name: 'skill', arguments: { name: 'aw-task-diagnosis' } });
  expect(result).toMatchObject({ data: { status: 'completed' } });
  const content = JSON.stringify(result?.data);
  expect(content).toContain('tasks_reverifyRequirements');
  expect(content).toContain('tasks_updateCheckCommand');
  expect(content).toContain('existing confirmation card');
  expect(content).toContain('整理为项目约定');

  const requirement = await say(conversation.id, { name: 'skill', arguments: { name: 'aw-task-requirement' } });
  expect(requirement).toMatchObject({ data: { status: 'completed' } });
  expect(JSON.stringify(requirement?.data)).toContain('Older plans may have only a package-level link');
});

it('@opencode 同一对话从帮我批准切到完全访问再切回始终询问，每次执行使用当前权限', async () => {
  const { body: c } = await t.call(createConversationOp, { permissionMode: 'assisted' });
  const cards = rejectedPermissions.length;
  const op = { name: 'bash' as const, arguments: { command: 'pwd', description: '查看工作目录' } };
  const before = reviewerTools.length;
  expect(await say(c.id, op)).toMatchObject({ data: { status: 'completed' } });
  expect(reviewerTools.slice(before)).toEqual([[]]);
  expect(rejectedPermissions).toHaveLength(cards);
  await t.call(setConversationPermissionModeOp, { id: c.id, permissionMode: 'full' });
  expect(
    await say(c.id, { name: 'bash', arguments: { command: 'echo scoped-full', description: '输出验证标记' } }),
  ).toMatchObject({ data: { output: expect.stringContaining('scoped-full') } });
  await t.call(setConversationPermissionModeOp, { id: c.id, permissionMode: 'ask' });
  expect(await say(c.id, op)).toMatchObject({ data: { status: 'error' } });
  expect(rejectedPermissions.slice(cards)).toContain('bash');
  await t.call(setConversationPermissionModeOp, { id: c.id, permissionMode: 'assisted' });
  const fallback = await say(c.id, { name: 'bash', arguments: { command: 'pwd', description: 'MALFORMED_REVIEW' } });
  expect(fallback).toMatchObject({ data: { status: 'error' } });
  expect(rejectedPermissions.slice(cards)).toEqual(['bash', 'bash']);
});

it('@opencode 用户记住的 Bash 命令切到帮我批准后跳过模型，相似命令仍送审', async () => {
  const { body: c } = await t.call(createConversationOp, { permissionMode: 'ask' });
  const op = { name: 'bash' as const, arguments: { command: 'pwd', description: '查看当前目录' } };
  expect(await say(c.id, op, PermissionDecision.Always)).toMatchObject({ data: { status: 'completed' } });
  await t.call(setConversationPermissionModeOp, { id: c.id, permissionMode: 'assisted' });
  const before = reviewerTools.length;
  expect(await say(c.id, op)).toMatchObject({ data: { status: 'completed' } });
  expect(reviewerTools).toHaveLength(before);
  expect(await say(c.id, { name: 'bash', arguments: { command: 'ls -l', description: '列出文件' } })).toMatchObject({
    data: { status: 'completed' },
  });
  expect(reviewerTools).toHaveLength(before + 1);
});
