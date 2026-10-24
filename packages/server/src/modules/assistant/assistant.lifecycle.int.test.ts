import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  AppError,
  createConversationOp,
  deleteConversationOp,
  ErrorCode,
  getConversationOp,
  OPENCODE_ASSISTANT_AGENT,
  readonlyBashRules,
  ServerEventType,
  sendAssistantMessageOp,
} from '@aw/shared';
import { afterEach, expect, it, vi } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { OpencodeEventType as E } from '../opencode/index.ts';

let t: TestApp | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await t?.close();
});
const HOME = { page: 'home', params: {} } as const;

it('原生自动完成其他权限后，助手同步清空卡片；重复事件和 HTTP 返回不会重复恢复', async () => {
  t = await createTestApp();
  const app = t;
  const c = (await app.call(createConversationOp, {})).body;
  app.fake.enqueue(script().requestPermission('bash', ['find . -name first']).hang());
  const asked = waitForEvent(
    app.app.events,
    ServerEventType.AssistantUpdated,
    (event) => event.id === c.id && event.pendingPermissions.length > 0,
  );
  await app.call(sendAssistantMessageOp, { id: c.id, text: '读取', context: HOME });
  const permission = (await asked).pendingPermissions[0];
  const session = app.fake.sessions.at(-1);
  if (permission === undefined || session === undefined) throw new Error('missing permission session');
  app.fake.replay([
    {
      type: E.PermissionAsked,
      sessionId: session.id,
      directory: session.directory,
      permissionId: 'auto-permission',
      permission: 'bash',
      patterns: ['find . -name second'],
    },
  ]);
  const replies = [permission.permissionId, 'auto-permission'].map((permissionId) => ({
    type: E.PermissionReplied,
    sessionId: session.id,
    permissionId,
    reply: 'always' as const,
  }));
  const reply = app.fake.replyPermission.bind(app.fake);
  vi.spyOn(app.fake, 'replyPermission').mockImplementation(async (input) => {
    app.fake.replay(replies);
    await reply(input);
  });
  expect(await app.app.services.assistant.replyPermission(c.id, permission.permissionId, 'always')).toMatchObject({
    pendingPermissions: [],
    busy: true,
  });
  app.fake.replay(replies);
  expect((await app.call(getConversationOp, { id: c.id })).body).toMatchObject({ pendingPermissions: [], busy: true });
});

it('不同对话在各自的文件目录运行；删除底层会话失败时保留聊天，成功后一起清理', async () => {
  t = await createTestApp();
  const app = t;
  const a = (await app.call(createConversationOp, {})).body;
  const b = (await app.call(createConversationOp, {})).body;
  for (const c of [a, b]) {
    await app.call(sendAssistantMessageOp, { id: c.id, text: '你好', context: HOME });
    await app.fake.settled();
  }
  expect(app.fake.sessions.map((s) => s.directory)).toEqual([
    join(realpathSync(app.dataDir), 'assistant', 'files', a.id),
    join(realpathSync(app.dataDir), 'assistant', 'files', b.id),
  ]);
  const remove = vi
    .spyOn(app.fake, 'deleteSession')
    .mockRejectedValueOnce(new AppError(ErrorCode.OpencodeRequestFailed, 'delete failed'));
  expect((await app.call(deleteConversationOp, { id: a.id })).body).toMatchObject({
    error: { code: ErrorCode.OpencodeRequestFailed },
  });
  expect((await app.call(getConversationOp, { id: a.id })).status).toBe(200);
  remove.mockRestore();
  expect((await app.call(deleteConversationOp, { id: a.id })).status).toBe(204);
  expect(app.fake.sessions.map((s) => s.directory)).toEqual([
    join(realpathSync(app.dataDir), 'assistant', 'files', b.id),
  ]);
});

it('首条发送尚在建底层会话时拒绝删除，避免孤儿会话与消息', async () => {
  t = await createTestApp();
  const app = t;
  const c = (await app.call(createConversationOp, {})).body;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const create = app.fake.createSession.bind(app.fake);
  vi.spyOn(app.fake, 'createSession').mockImplementation(async (input) => {
    entered.resolve();
    await release.promise;
    return create(input);
  });
  const sending = app.call(sendAssistantMessageOp, { id: c.id, text: '你好', context: HOME });
  await entered.promise;
  const deleting = await app.call(deleteConversationOp, { id: c.id });
  release.resolve();
  const sent = await sending;
  await app.fake.settled();
  expect(deleting.body).toMatchObject({ error: { code: ErrorCode.AssistantBusy } });
  expect(sent.status).toBe(200);
  expect((await app.call(deleteConversationOp, { id: c.id })).status).toBe(204);
  expect(app.fake.sessions).toEqual([]);
});

it('删除运行中对话时中止并清理，不再发送该对话排队中的系统消息', async () => {
  t = await createTestApp();
  const app = t;
  const c = (await app.call(createConversationOp, {})).body;
  app.fake.enqueue(script().text('开始').hang(), { agent: OPENCODE_ASSISTANT_AGENT });
  const started = waitForEvent(
    app.app.events,
    ServerEventType.AssistantTranscript,
    (e) => e.conversationId === c.id && e.entries.some((entry) => entry.kind === 'text'),
  );
  await app.call(sendAssistantMessageOp, { id: c.id, text: '工作', context: HOME });
  await started;
  app.app.services.assistant.queueMessage(c.id, '尚未发送的结果');
  expect((await app.call(deleteConversationOp, { id: c.id })).status).toBe(204);
  await app.fake.settled();
  expect(app.fake.prompts.map((p) => p.text)).toEqual(['工作']);
  expect(app.fake.sessions).toEqual([]);
  expect(app.logs.filter((l) => l.level >= 50)).toEqual([]);
});

it('旧会话隔离升级的清理失败可跨重启恢复，历史仍在且只回放可见文字一次', async () => {
  t = await createTestApp();
  const app = t;
  const c = (await app.call(createConversationOp, { title: '旧对话' })).body;
  const oldSession = await app.fake.createSession({
    directory: join(realpathSync(app.dataDir), 'assistant'),
    title: '旧对话',
    agent: OPENCODE_ASSISTANT_AGENT,
    permission: readonlyBashRules(),
  });
  const db = new DatabaseSync(join(app.dataDir, 'app.db'));
  try {
    db.prepare('UPDATE assistant_conversations SET isolated = 0, opencode_session_id = ? WHERE id = ?').run(
      oldSession,
      c.id,
    );
  } finally {
    db.close();
  }
  const historyDirectory = join(app.dataDir, 'assistant', 'conversations');
  mkdirSync(historyDirectory, { recursive: true });
  const file = join(historyDirectory, `${c.id}.jsonl`);
  writeFileSync(
    file,
    `${[
      { seq: 1, ts: 1, kind: 'user_message', data: { text: '之前约定的蓝色方案' } },
      { seq: 2, ts: 2, kind: 'text', partId: 'old-text', data: { text: '已记录蓝色方案', offset: 0 } },
      { seq: 3, ts: 3, kind: 'reasoning', partId: 'old-reason', data: { text: '不应回放的内部推理', offset: 0 } },
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n')}\n`,
  );
  vi.spyOn(app.fake, 'deleteSession').mockRejectedValueOnce(new AppError(ErrorCode.OpencodeRequestFailed));
  expect((await app.call(sendAssistantMessageOp, { id: c.id, text: '继续', context: HOME })).body).toMatchObject({
    error: { code: ErrorCode.OpencodeRequestFailed },
  });
  expect(app.fake.prompts).toEqual([]);
  expect(app.fake.sessions.map((session) => session.id)).toContain(oldSession);
  vi.restoreAllMocks();
  await app.close();
  t = await createTestApp({ dataDir: app.dataDir, fake: app.fake });
  expect((await t.call(sendAssistantMessageOp, { id: c.id, text: '继续蓝色方案', context: HOME })).status).toBe(200);
  await t.fake.settled();
  expect(t.fake.sessions.map((session) => session.id)).not.toContain(oldSession);
  expect(t.fake.prompts.at(-1)?.text).toContain('之前约定的蓝色方案');
  expect(t.fake.prompts.at(-1)?.text).not.toContain('不应回放的内部推理');
  expect(t.fake.prompts.at(-1)?.directory).toBe(t.app.services.assistant.filesDir(c.id));
  expect(readFileSync(file, 'utf8')).toContain('之前约定的蓝色方案');
  await t.call(sendAssistantMessageOp, { id: c.id, text: '下一轮', context: HOME });
  await t.fake.settled();
  expect(t.fake.prompts.at(-1)?.text).toBe('下一轮');
});

it('删除时停止失败不掩盖之后真正的模型错误，聊天仍可清理', async () => {
  t = await createTestApp();
  const app = t;
  const c = (await app.call(createConversationOp, {})).body;
  app.fake.enqueue(script().requestPermission('bash', ['echo work']).error('ProviderError', '实际模型失败'));
  const asked = waitForEvent(
    app.app.events,
    ServerEventType.AssistantUpdated,
    (event) => event.id === c.id && event.pendingPermissions.length > 0,
  );
  await app.call(sendAssistantMessageOp, { id: c.id, text: '工作', context: HOME });
  const permission = (await asked).pendingPermissions[0];
  if (permission === undefined) throw new Error('Expected permission');
  vi.spyOn(app.fake, 'abort').mockRejectedValueOnce(new AppError(ErrorCode.OpencodeRequestFailed, 'abort failed'));
  expect((await app.call(deleteConversationOp, { id: c.id })).status).toBe(502);
  await app.app.services.assistant.replyPermission(c.id, permission.permissionId, 'reject');
  await app.fake.settled();
  const entries = app.app.services.assistant.transcript(c.id, 0).entries;
  expect(entries).toContainEqual(
    expect.objectContaining({
      kind: 'error',
      data: expect.objectContaining({ message: 'ProviderError', details: { message: '实际模型失败' } }),
    }),
  );
  expect(entries.filter((entry) => entry.kind === 'system' && entry.data.event === 'aborted')).toEqual([]);
  expect((await app.call(deleteConversationOp, { id: c.id })).status).toBe(204);
});
