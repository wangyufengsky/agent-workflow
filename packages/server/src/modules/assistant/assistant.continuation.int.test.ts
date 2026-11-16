import {
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
