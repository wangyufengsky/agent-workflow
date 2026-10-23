import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  createConversationOp,
  deleteConversationOp,
  OPENCODE_ASSISTANT_AGENT,
  PermissionDecision,
  ServerEventType,
  sendAssistantMessageOp,
  type TranscriptPage,
  updateSettingsOp,
} from '@aw/shared';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { assistantPermissionRules } from '../opencode/index.ts';

const MODEL = 'aw-assistant-scripted/model';
const TOOL_PREFIX = 'TOOL_INPUT: ';
const advertisedTools = new Set<string>();
const rejectedPermissions: string[] = [];
const requestSchema = z.object({
  tools: z.array(z.object({ function: z.object({ name: z.string() }) })).default([]),
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.union([z.string(), z.array(z.object({ type: z.string(), text: z.string().optional() }))]).nullable(),
    }),
  ),
});
const callSchema = z.object({ name: z.enum(['read', 'write', 'bash']), arguments: z.record(z.string(), z.unknown()) });

async function bodyOf(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

/** 本地模型仅指定工具调用；真实 opencode 决定文件边界，测试不替代工具或权限判断。 */
function scriptedModel(): Server {
  return createServer((req, res) => {
    void (async () => {
      const { messages, tools } = await bodyOf(req);
      for (const tool of tools) advertisedTools.add(tool.function.name);
      const last = messages.at(-1);
      const text =
        typeof last?.content === 'string' ? last.content : (last?.content ?? []).map((p) => p.text ?? '').join('');
      const instruction =
        last?.role === 'user' && text.includes(TOOL_PREFIX)
          ? callSchema.parse(JSON.parse(text.slice(text.lastIndexOf(TOOL_PREFIX) + TOOL_PREFIX.length)))
          : undefined;
      const delta =
        instruction === undefined
          ? { role: 'assistant', content: 'done' }
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
  await new Promise<void>((resolve, reject) => model.close((error) => (error ? reject(error) : resolve())));
});

async function say(id: string, instruction: z.infer<typeof callSchema>) {
  const seen = new Set<string>();
  const replies: Promise<unknown>[] = [];
  const unsubscribe = t.app.events.subscribe((event) => {
    if (event.type !== ServerEventType.AssistantUpdated || event.data.id !== id) return;
    for (const permission of event.data.pendingPermissions) {
      if (seen.has(permission.permissionId)) continue;
      seen.add(permission.permissionId);
      rejectedPermissions.push(permission.permission);
      replies.push(t.app.services.assistant.replyPermission(id, permission.permissionId, PermissionDecision.Reject));
    }
  });
  const idle = waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.id === id && !c.busy, 60_000);
  const response = await t.call(sendAssistantMessageOp, {
    id,
    text: `${TOOL_PREFIX}${JSON.stringify(instruction)}`,
    context: { page: 'home', params: {} },
  });
  expect(response.status).toBe(200);
  await idle;
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
