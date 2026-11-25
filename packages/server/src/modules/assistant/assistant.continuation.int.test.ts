import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import {
  ASSISTANT_CONVERSATIONS_DIR,
  ASSISTANT_DIR,
  ATTACHMENT_NAME_HEADER,
  createAssistantContinuationOp,
  createConversationOp,
  deleteConversationOp,
  ErrorCode,
  getAssistantContinuationHistoryOp,
  getConversationOp,
  listAssistantAttachmentsOp,
  listConversationsOp,
  OPENCODE_ASSISTANT_AGENT,
  ServerEventType,
  sendAssistantMessageOp,
  TRANSCRIPT_PAGE_SIZE,
  updateSettingsOp,
} from '@aw/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => {
  vi.restoreAllMocks();
  return t.close();
});

async function say(id: string, text: string) {
  const idle = waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.id === id && !c.busy);
  await t.call(sendAssistantMessageOp, { id, text, context: { page: 'home', params: {} } });
  await idle;
}

it('续接多页历史时后端仍能处理其他事件，重复请求只生成同一个交接', async () => {
  const source = (await t.call(createConversationOp, {})).body;
  const directory = join(t.dataDir, ASSISTANT_DIR, ASSISTANT_CONVERSATIONS_DIR);
  await mkdir(directory, { recursive: true });
  const file = join(directory, `${source.id}.jsonl`);
  const length = TRANSCRIPT_PAGE_SIZE * 3 + 1;
  const lines = Array.from({ length }, (_, i) =>
    JSON.stringify({
      seq: i + 1,
      ts: 1,
      kind: 'user_message',
      data: { text: i === length - 1 ? '最后一条需求' : '历史消息' },
    }),
  );
  await writeFile(file, lines.join('\n') + '\n');
  const request = { id: source.id, requestId: crypto.randomUUID(), attachmentIds: [] };
  const turn = nextTurn('event');
  const child = Promise.resolve(t.app.services.assistant.continueConversation(request));
  expect(await Promise.race([turn, child.then(() => 'finished')])).toBe('event');
  const duplicate = await t.app.services.assistant.continueConversation(request);
  expect(duplicate.id).toBe((await child).id);
  expect(duplicate.continuation?.cutoffSeq).toBe(length);
  await say(duplicate.id, '继续');
  expect(t.fake.prompts.at(-1)?.text).toContain('最后一条需求');
});

it('续接隔离模型会话、固定历史范围，并在来源删除后保留交接', async () => {
  const { project } = await addProject(t);
  const source = (await t.call(createConversationOp, { projectId: project.id })).body;
  t.fake.enqueue(script().text('已确认使用方案 A，任务 T-123'), { agent: OPENCODE_ASSISTANT_AGENT });
  await say(source.id, '确认方案 A');
  const request = { id: source.id, requestId: crypto.randomUUID(), attachmentIds: [] };
  const child = (await t.call(createAssistantContinuationOp, request)).body;
  expect((await t.call(createAssistantContinuationOp, request)).body.id).toBe(child.id);
  expect(child.projectId).toBe(project.id);
  await say(source.id, '续接之后的消息');
  const history = (await t.call(getAssistantContinuationHistoryOp, { id: child.id, afterSeq: 0 })).body;
  expect(JSON.stringify(history.entries)).not.toContain('续接之后的消息');
  const sourceRemoved = waitForEvent(
    t.app.events,
    ServerEventType.AssistantUpdated,
    (c) => c.id === child.id && c.continuation?.sourceAvailable === false,
  );
  await t.call(deleteConversationOp, { id: source.id });
  await sourceRemoved;
  expect((await t.call(getConversationOp, { id: child.id })).body.continuation?.sourceAvailable).toBe(false);
  await say(child.id, '继续');
  expect(t.fake.prompts.at(-1)?.text).toContain('方案 A');
  expect(t.fake.prompts.at(-1)?.sessionId).not.toBe(t.fake.prompts[0]?.sessionId);
  expect((await t.call(getConversationOp, { id: child.id })).body.continuation?.consumedAt).not.toBeNull();
  await say(child.id, '下一轮');
  expect(t.fake.prompts.at(-1)?.text).toBe('下一轮');
});

it('上下文超限时将失败输入带到续接草稿，接受前失败不会消费交接', async () => {
  await t.call(updateSettingsOp, { 'ai.contextEngine': false });
  const source = (await t.call(createConversationOp, {})).body;
  t.fake.enqueue(script().error('ContextOverflowError', 'context too long'), { agent: OPENCODE_ASSISTANT_AGENT });
  await say(source.id, '请继续处理这段输入');
  t.app.services.assistant.recordConfirmation(source.id, 'later-app-card');
  const child = (
    await t.call(createAssistantContinuationOp, { id: source.id, requestId: crypto.randomUUID(), attachmentIds: [] })
  ).body;
  expect(child.continuation?.draftText).toBe('请继续处理这段输入');
  t.fake.failNextPrompt();
  await t.call(sendAssistantMessageOp, { id: child.id, text: '编辑后的输入', context: { page: 'home', params: {} } });
  expect((await t.call(getConversationOp, { id: child.id })).body.continuation).toMatchObject({
    consumedAt: null,
    draftText: '请继续处理这段输入',
  });
});

it('选中附件在重启后仍归属新对话，未选中的附件不可读', async () => {
  const source = (await t.call(createConversationOp, {})).body;
  async function upload(name: string, content: string) {
    return (
      await t.request({
        method: 'POST',
        url: '/attachments',
        headers: { 'content-type': 'application/octet-stream', [ATTACHMENT_NAME_HEADER]: encodeURIComponent(name) },
        payload: content,
      })
    ).json();
  }
  const chosen = await upload('chosen.txt', '保留的资料');
  const omitted = await upload('omitted.txt', '不带的资料');
  const retryOnly = await upload('retry-only.txt', '失败后取消的新附件');
  const idle = waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.id === source.id && !c.busy);
  await t.call(sendAssistantMessageOp, {
    id: source.id,
    text: '资料',
    context: { page: 'home', params: {} },
    attachmentIds: [chosen.id, omitted.id],
  });
  await idle;
  const child = (
    await t.call(createAssistantContinuationOp, {
      id: source.id,
      requestId: crypto.randomUUID(),
      attachmentIds: [chosen.id],
    })
  ).body;
  expect(child.continuation?.attachmentIds).toEqual([chosen.id]);
  expect((await t.call(listAssistantAttachmentsOp, { id: child.id })).body.items.map((a) => a.id)).toEqual([chosen.id]);
  const dataDir = t.dataDir;
  const fake = t.fake;
  await t.close();
  t = await createTestApp({ dataDir, fake });
  await t.call(deleteConversationOp, { id: source.id });
  t.fake.failNextPrompt();
  await t.call(sendAssistantMessageOp, {
    id: child.id,
    text: '第一次尝试',
    context: { page: 'home', params: {} },
    attachmentIds: [retryOnly.id],
  });
  expect((await t.call(getConversationOp, { id: child.id })).body.continuation?.attachmentIds).toEqual([chosen.id]);
  await say(child.id, '继续');
  expect(t.fake.prompts.at(-1)?.text).toContain('保留的资料');
  expect(t.fake.prompts.at(-1)?.text).not.toContain('不带的资料');
  expect(t.fake.prompts.at(-1)?.text).not.toContain('失败后取消的新附件');
  expect((await t.call(listAssistantAttachmentsOp, { id: child.id })).body.items.map((a) => a.id)).toEqual([
    chosen.id,
    retryOnly.id,
  ]);
});

it('连续续接保留上次交接和尚未发送的超限草稿', async () => {
  const source = (await t.call(createConversationOp, {})).body;
  t.fake.enqueue(script().error('ContextOverflowError', 'too long'), { agent: OPENCODE_ASSISTANT_AGENT });
  await say(source.id, '已确认方案 A，任务 T-123');
  const first = (
    await t.call(createAssistantContinuationOp, { id: source.id, requestId: crypto.randomUUID(), attachmentIds: [] })
  ).body;
  const second = (
    await t.call(createAssistantContinuationOp, { id: first.id, requestId: crypto.randomUUID(), attachmentIds: [] })
  ).body;
  expect(second.continuation?.draftText).toBe('已确认方案 A，任务 T-123');
  await t.call(deleteConversationOp, { id: source.id });
  await t.call(deleteConversationOp, { id: first.id });
  await say(second.id, '继续');
  expect(t.fake.prompts.at(-1)?.text).toContain('任务 T-123');
  const listed = (await t.call(listConversationsOp, {})).body.items.find((c) => c.id === second.id);
  expect(listed?.continuation?.sourceAvailable).toBe(false);
});

it('续接对话已有新消息时，再次续接仍携带上次较长的近期上下文', async () => {
  const source = (await t.call(createConversationOp, {})).body;
  await say(source.id, '当前工作涉及 payment-service');
  await say(source.id, `改动背景：${'x'.repeat(480)}。就按原接口做，继续核对 T-231。`);
  async function continueFrom(id: string) {
    return (await t.call(createAssistantContinuationOp, { id, requestId: crypto.randomUUID(), attachmentIds: [] }))
      .body;
  }
  const child = await continueFrom(source.id);
  await say(child.id, '继续');
  const grandchild = await continueFrom(child.id);
  await say(grandchild.id, '再接着做');
  const prompt = t.fake.prompts.at(-1)?.text;
  expect(prompt).toContain('payment-service');
  expect(prompt).toContain('就按原接口做，继续核对 T-231');
  expect(prompt).toContain('User: "继续"');
});

it('忙碌的来源不能创建快照，待确认权限不会复制到新会话', async () => {
  const source = (await t.call(createConversationOp, {})).body;
  t.fake.enqueue(script().requestPermission('bash', ['echo work']).hang());
  const asked = waitForEvent(
    t.app.events,
    ServerEventType.AssistantUpdated,
    (c) => c.id === source.id && c.pendingPermissions.length > 0,
  );
  await t.call(sendAssistantMessageOp, { id: source.id, text: '工作', context: { page: 'home', params: {} } });
  await asked;
  const request = { id: source.id, requestId: crypto.randomUUID(), attachmentIds: [] };
  expect((await t.call(createAssistantContinuationOp, request)).body).toMatchObject({
    error: { code: ErrorCode.AssistantBusy },
  });
  await t.app.services.assistant.abort(source.id);
  const child = (await t.call(createAssistantContinuationOp, request)).body;
  expect(child.pendingPermissions).toEqual([]);
});

it('删除来源期间拒绝创建续接，避免引用正在清理的历史与附件', async () => {
  const source = (await t.call(createConversationOp, {})).body;
  await say(source.id, '已有消息');
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const remove = t.fake.deleteSession.bind(t.fake);
  vi.spyOn(t.fake, 'deleteSession').mockImplementation(async (input) => {
    entered.resolve();
    await release.promise;
    await remove(input);
  });
  const deleting = t.call(deleteConversationOp, { id: source.id });
  await entered.promise;
  expect(
    (await t.call(createAssistantContinuationOp, { id: source.id, requestId: crypto.randomUUID(), attachmentIds: [] }))
      .body,
  ).toMatchObject({ error: { code: ErrorCode.AssistantBusy } });
  release.resolve();
  expect((await deleting).status).toBe(204);
});

it('应用回传的超限错误不会把上一条成功用户输入误当作失败草稿', async () => {
  const source = (await t.call(createConversationOp, {})).body;
  await say(source.id, '已成功的消息');
  t.fake.enqueue(script().error('ContextOverflowError', 'too long'), { agent: OPENCODE_ASSISTANT_AGENT });
  const idle = waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.id === source.id && !c.busy);
  await t.app.services.assistant.deliver(source.id, '应用通知');
  await idle;
  const child = (
    await t.call(createAssistantContinuationOp, { id: source.id, requestId: crypto.randomUUID(), attachmentIds: [] })
  ).body;
  expect(child.continuation?.draftText).toBeNull();
});

it.each(['compaction fails', 'retry overflows'])('自动恢复后仍超窗时可续接原输入（%s）', async (scenario) => {
  const c = (await t.call(createConversationOp, {})).body;
  const first = Promise.withResolvers<{ error: { name: string; data: { message: string } } }>();
  const original = t.fake.promptAssistant;
  const prompts = vi
    .spyOn(t.fake, 'promptAssistant')
    .mockImplementationOnce(() => ({
      accepted: Promise.resolve(),
      started: Promise.resolve(),
      isRunning: async () => true,
      completed: first.promise,
    }))
    .mockImplementation(original);
  const compactor = vi.spyOn(t.fake, 'summarizeSession');
  if (scenario === 'compaction fails') compactor.mockRejectedValueOnce(new Error('compactor failed'));
  else t.fake.enqueue(script().error('ContextOverflowError', 'still too long'));
  const idle = waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (v) => v.id === c.id && !v.busy);
  const text = '继续核对这份资料';
  await t.call(sendAssistantMessageOp, { id: c.id, text, context: { page: 'home', params: {} } });
  t.app.services.assistant.manageContext(c.id, 'opencode/fake-model');
  first.resolve({ error: { name: 'ContextOverflowError', data: { message: 'too long' } } });
  await idle;
  expect(compactor).toHaveBeenCalledTimes(1);
  expect(prompts).toHaveBeenCalledTimes(scenario === 'compaction fails' ? 1 : 2);
  expect(new Set(prompts.mock.calls.map(([p]) => p.sessionId)).size).toBe(1);
  const child = (
    await t.call(createAssistantContinuationOp, { id: c.id, requestId: crypto.randomUUID(), attachmentIds: [] })
  ).body;
  expect(child.continuation?.draftText).toBe(text);
});
