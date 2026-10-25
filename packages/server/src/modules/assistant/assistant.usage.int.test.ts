import { readFileSync } from 'node:fs';
import {
  AppError,
  AssistantPage,
  AssistantTurnEvent,
  AssistantTurnStatus,
  ATTACHMENT_NAME_HEADER,
  type AttachmentDTO,
  abortAssistantOp,
  createConversationOp,
  deleteConversationOp,
  ErrorCode,
  getConversationOp,
  replyAssistantPermissionOp,
  ServerEventType,
  sendAssistantMessageOp,
  updateSettingsOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeOpencode, script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createFakeClock, type FakeClock } from '../../../test/helpers/clock.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { type OpencodeEvent, OpencodeEventType, parseGlobalEvent } from '../opencode/index.ts';

let t: TestApp;
let clock: FakeClock;
const HOME = { page: AssistantPage.Home, params: {} };
beforeEach(async () => {
  clock = createFakeClock();
  t = await createTestApp({ clock });
});
afterEach(() => t.close());
const create = async () => (await t.call(createConversationOp, {})).body.id;
const send = (id: string) => t.call(sendAssistantMessageOp, { id, text: '你好', context: HOME });
const get = async (id: string) => (await t.call(getConversationOp, { id })).body;

async function hang(id: string) {
  const text = waitForEvent(
    t.app.events,
    ServerEventType.AssistantTranscript,
    (data) => data.conversationId === id && data.entries.some((entry) => entry.kind === 'text'),
  );
  // 中止后不会执行下一步或报告默认用量。
  t.fake.enqueue(script().text('正在工作').hang().text('不会到达'));
  await send(id);
  await text;
}

describe('助手真实用量与单轮时限', () => {
  it('外部请求前记录轮次，累计实际报告；未报告、发送失败不伪造为零', async () => {
    const id = await create();
    const createSession = t.fake.createSession.bind(t.fake);
    vi.spyOn(t.fake, 'createSession').mockImplementationOnce(async (input) => {
      // 外部会话尚在建立时用户改设置，不应改变本轮实际模型与账本快照。
      await t.call(updateSettingsOp, { 'ai.defaultModel': 'provider/next-turn' });
      return createSession(input);
    });
    const original = t.fake.prompt.bind(t.fake);
    vi.spyOn(t.fake, 'prompt').mockImplementationOnce(async (input) => {
      expect((await get(id)).usage.latest).toMatchObject({ status: AssistantTurnStatus.Running, tokensInput: null });
      clock.advance(250);
      await original(input);
    });
    t.fake.enqueue(script().usage(120, 30).text('你好'));
    await send(id);
    await t.fake.settled();
    expect((await get(id)).usage).toMatchObject({
      turns: 1,
      unknownTurns: 0,
      tokensInput: 120,
      tokensOutput: 30,
      latest: {
        source: 'user',
        status: AssistantTurnStatus.Completed,
        elapsedMs: 250,
        tokensInput: 120,
        tokensOutput: 30,
        model: null,
      },
    });
    expect(t.fake.prompts[0]?.model).toBeUndefined();
    t.fake.failNextPrompt();
    expect((await send(id)).status).toBe(502);
    expect((await get(id)).usage).toMatchObject({
      turns: 2,
      unknownTurns: 1,
      tokensInput: 120,
      tokensOutput: 30,
      latest: { status: AssistantTurnStatus.Failed, tokensInput: null, tokensOutput: null },
    });
  });

  it('真实 StepFinished 事件重放不重复累计；迟到报告仍归原轮次，重启保留已知用量', async () => {
    const id = await create();
    let message: Extract<OpencodeEvent, { type: typeof OpencodeEventType.Message }> | undefined;
    t.fake.subscribe((event) => {
      if (event.type === OpencodeEventType.Message) message = event;
    });
    await hang(id);
    if (message === undefined) throw new Error('Expected assistant message');
    const raw: unknown[] = JSON.parse(
      readFileSync(new URL('../../../test/fixtures/opencode-1.19.0-events.json', import.meta.url), 'utf8'),
    );
    const steps = raw.map(parseGlobalEvent).filter((event) => event?.type === OpencodeEventType.StepFinished);
    const first = steps[0];
    if (first === undefined) throw new Error('Recorded fixture lacks usage');
    const oldMessage = message;
    const replay = { ...first, sessionId: message.sessionId, messageId: message.messageId };
    t.fake.replay([replay, replay]);
    expect((await get(id)).usage.tokensInput).toBe(first.tokens.input);
    await t.call(abortAssistantOp, { id });
    await t.fake.settled();
    t.fake.enqueue(script().usage(5, 2));
    await send(id);
    await t.fake.settled();
    // 旧消息的另一条迟到 step 仍归旧轮；再次重放同一条不会增加。
    const lateMessage = { ...oldMessage, messageId: `${oldMessage.messageId}-late` };
    const late = { ...replay, messageId: lateMessage.messageId, partId: `${replay.partId}-late` };
    t.fake.replay([replay, lateMessage, late, late]);
    expect((await get(id)).usage).toMatchObject({
      tokensInput: first.tokens.input * 2 + 5,
      tokensOutput: first.tokens.output * 2 + 2,
      latest: { tokensInput: 5, tokensOutput: 2 },
    });
    const { dataDir, fake } = t;
    await t.close();
    t = await createTestApp({ dataDir, fake, clock });
    expect((await get(id)).usage).toMatchObject({
      turns: 2,
      tokensInput: first.tokens.input * 2 + 5,
      latest: { status: AssistantTurnStatus.Completed },
    });
  });

  it('权限等待暂停时限；恢复后超时只中止一次，用户停止与模型错误分别记录', async () => {
    await t.call(updateSettingsOp, { 'attempt.timeoutMinutes': 1 });
    const id = await create();
    const permission = waitForEvent(
      t.app.events,
      ServerEventType.AssistantUpdated,
      (c) => c.id === id && c.pendingPermissions.length === 1,
    );
    const prompt = t.fake.prompt.bind(t.fake);
    vi.spyOn(t.fake, 'prompt').mockImplementationOnce(async (input) => {
      clock.advance(20_000);
      await prompt(input);
    });
    t.fake.enqueue(script().requestPermission('bash', ['echo hello']).hang().text('不会到达'));
    await send(id);
    const asked = (await permission).pendingPermissions[0];
    if (asked === undefined) throw new Error('Expected permission');
    clock.advance(600_000);
    expect((await get(id)).usage.latest?.status).toBe(AssistantTurnStatus.Running);
    expect(t.fake.aborts).toEqual([]);
    await t.call(replyAssistantPermissionOp, { id, permissionId: asked.permissionId, reply: 'once' });
    clock.advance(39_999);
    expect((await get(id)).busy).toBe(true);
    const stopped = waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.id === id && !c.busy);
    clock.advance(1);
    await stopped;
    expect((await get(id)).usage.latest).toMatchObject({
      status: AssistantTurnStatus.TimedOut,
      endReason: AssistantTurnEvent.Timeout,
      elapsedMs: 660_000,
      tokensInput: null,
    });
    expect(t.fake.aborts).toHaveLength(1);
    expect(t.fake.prompts).toHaveLength(1);

    await hang(id);
    await t.call(abortAssistantOp, { id });
    await t.fake.settled();
    expect((await get(id)).usage.latest?.status).toBe(AssistantTurnStatus.Aborted);
    t.fake.enqueue(script().error('ProviderError', 'model unavailable', { idle: false }));
    await send(id);
    await t.fake.settled();
    expect((await get(id)).usage.latest?.status).toBe(AssistantTurnStatus.Failed);
  });

  it('模型服务不可用、opencode 重试期间不计入时限，恢复后按剩余时间继续（D163）', async () => {
    await t.call(updateSettingsOp, { 'attempt.timeoutMinutes': 1 });
    const id = await create();
    const down = 'Cannot connect to API: Unable to connect. Is the computer able to access the url?';
    const retrying = waitForEvent(t.app.events, ServerEventType.AssistantTranscript, (data) =>
      data.entries.some((entry) => entry.kind === 'system' && entry.data.detail === down),
    );
    const prompt = t.fake.prompt.bind(t.fake);
    vi.spyOn(t.fake, 'prompt').mockImplementationOnce(async (input) => {
      clock.advance(20_000);
      await prompt(input);
    });
    t.fake.enqueue(script().retry(down).text('回来了').hang());
    await send(id);
    await retrying;
    clock.advance(60 * 60_000);
    expect((await get(id)).busy).toBe(true);
    expect(t.fake.aborts).toEqual([]);

    const back = waitForEvent(t.app.events, ServerEventType.AssistantTranscript, (data) =>
      data.entries.some((entry) => entry.kind === 'text'),
    );
    t.fake.recoverModel();
    await back;
    clock.advance(39_999);
    expect((await get(id)).busy).toBe(true);
    const stopped = waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.id === id && !c.busy);
    clock.advance(1);
    await stopped;
    expect((await get(id)).usage.latest).toMatchObject({
      status: AssistantTurnStatus.TimedOut,
      endReason: AssistantTurnEvent.Timeout,
    });
  });

  it('运行时消失与后端重启分别记录；重启不把离线时段算作实际耗时', async () => {
    const id = await create();
    await hang(id);
    clock.advance(500);
    t.fake.crash();
    expect((await get(id)).usage.latest).toMatchObject({
      status: AssistantTurnStatus.Interrupted,
      endReason: AssistantTurnEvent.RuntimeLost,
      elapsedMs: 500,
      tokensInput: null,
    });
    t.fake.reconnect();
    await hang(id);
    const { dataDir, fake } = t;
    await t.close();
    clock.advance(3_600_000);
    t = await createTestApp({ dataDir, fake, clock });
    expect((await get(id)).usage).toMatchObject({
      turns: 2,
      unknownTurns: 2,
      tokensInput: null,
      latest: {
        status: AssistantTurnStatus.Interrupted,
        endReason: AssistantTurnEvent.BackendRestart,
        elapsedMs: null,
      },
    });
    expect(t.fake.prompts).toHaveLength(2);
  });

  it('建会话失败保留失败轮次；创建期间超时后不再向迟到的会话发送', async () => {
    const id = await create();
    vi.spyOn(t.fake, 'createSession').mockRejectedValueOnce(new Error('creation failed'));
    await send(id);
    expect((await get(id)).usage.latest).toMatchObject({ status: AssistantTurnStatus.Failed, tokensInput: null });
    await t.call(updateSettingsOp, { 'attempt.timeoutMinutes': 1 });
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const original = t.fake.createSession.bind(t.fake);
    vi.spyOn(t.fake, 'createSession').mockImplementationOnce(async (input) => {
      entered.resolve();
      await release.promise;
      return original(input);
    });
    const uploaded = await t.request({
      method: 'POST',
      url: '/attachments',
      headers: { 'content-type': 'application/octet-stream', [ATTACHMENT_NAME_HEADER]: 'notes.md' },
      payload: 'preserved attachment',
    });
    const attachment = uploaded.json<AttachmentDTO>();
    const request = { id, text: '未发送的草稿', context: HOME, attachmentIds: [attachment.id] };
    const pending = t.call(sendAssistantMessageOp, request);
    await entered.promise;
    clock.advance(60_000);
    release.resolve();
    expect((await pending).status).toBe(409);
    expect((await get(id)).usage.latest?.status).toBe(AssistantTurnStatus.TimedOut);
    expect(t.fake.prompts).toEqual([]);
    expect((await t.request({ method: 'GET', url: `/attachments/${attachment.id}/content` })).body).toBe(
      'preserved attachment',
    );
    expect((await t.call(sendAssistantMessageOp, request)).status).toBe(200);
    await t.fake.settled();
    expect(t.fake.prompts.at(-1)?.text).toContain('preserved attachment');
  });

  it('超时停止请求失败时保留忙碌，不谎报停止，也不自动重试', async () => {
    await t.call(updateSettingsOp, { 'attempt.timeoutMinutes': 1 });
    const id = await create();
    await hang(id);
    vi.spyOn(t.fake, 'abort').mockRejectedValueOnce(new Error('abort unavailable'));
    const failed = waitForEvent(
      t.app.events,
      ServerEventType.AssistantTranscript,
      (c) => c.conversationId === id && c.entries.some((e) => e.kind === 'error'),
    );
    clock.advance(60_000);
    await failed;
    expect((await get(id)).busy).toBe(true);
    expect((await send(id)).status).toBe(409);
    clock.advance(60_000);
    expect(t.fake.abort).toHaveBeenCalledTimes(1);
    await t.call(abortAssistantOp, { id });
    await t.fake.settled();
    expect((await get(id)).busy).toBe(false);
    expect(t.fake.abort).toHaveBeenCalledTimes(2);
    expect(t.fake.prompts).toHaveLength(1);
  });

  it.each(['stop', 'delete'] as const)(
    '%s 响应尚未返回时，阻止另一种收尾与新消息；限时不重复中止',
    async (operation) => {
      await t.call(updateSettingsOp, { 'attempt.timeoutMinutes': 1 });
      const id = await create();
      await hang(id);
      clock.advance(55_000);
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const original = t.fake.abort.bind(t.fake);
      const abort = vi.spyOn(t.fake, 'abort').mockImplementationOnce(async (input) => {
        await original(input);
        entered.resolve();
        await release.promise;
      });
      const first = operation === 'stop' ? t.call(abortAssistantOp, { id }) : t.call(deleteConversationOp, { id });
      await entered.promise;
      expect(await get(id)).toMatchObject({ busy: true, usage: { latest: { status: AssistantTurnStatus.Running } } });
      const other =
        operation === 'stop' ? await t.call(deleteConversationOp, { id }) : await t.call(abortAssistantOp, { id });
      expect(other.status).toBe(409);
      expect((await send(id)).status).toBe(409);
      clock.advance(9_000);
      expect(abort).toHaveBeenCalledTimes(1);
      release.resolve();
      expect((await first).status).toBe(operation === 'stop' ? 200 : 204);
      await t.fake.settled();
      if (operation === 'stop') {
        expect((await get(id)).usage.latest?.status).toBe(AssistantTurnStatus.Aborted);
        expect((await t.call(deleteConversationOp, { id })).status).toBe(204);
      }
      clock.advance(120_000);
      expect(abort).toHaveBeenCalledTimes(1);
      expect(t.fake.prompts).toHaveLength(1);
      expect(t.logs.filter((entry) => entry.level >= 50)).toEqual([]);
    },
  );

  it('删除时停止成功但底层删除失败，保留已中止的轮次且不再触发时限', async () => {
    await t.call(updateSettingsOp, { 'attempt.timeoutMinutes': 1 });
    const id = await create();
    await hang(id);
    vi.spyOn(t.fake, 'deleteSession').mockRejectedValueOnce(new Error('delete unavailable'));
    expect((await t.call(deleteConversationOp, { id })).status).toBe(500);
    await t.fake.settled();
    expect(await get(id)).toMatchObject({ busy: false, usage: { latest: { status: AssistantTurnStatus.Aborted } } });
    clock.advance(120_000);
    expect(t.fake.aborts).toHaveLength(1);
    expect((await t.call(deleteConversationOp, { id })).status).toBe(204);
  });

  it('删除时停止失败，仍运行的轮次恢复剩余时限', async () => {
    await t.call(updateSettingsOp, { 'attempt.timeoutMinutes': 1 });
    const id = await create();
    await hang(id);
    clock.advance(20_000);
    vi.spyOn(t.fake, 'abort').mockRejectedValueOnce(new Error('abort unavailable'));
    expect((await t.call(deleteConversationOp, { id })).status).toBe(500);
    expect((await get(id)).usage.latest?.status).toBe(AssistantTurnStatus.Running);
    clock.advance(39_999);
    expect((await get(id)).busy).toBe(true);
    const stopped = waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.id === id && !c.busy);
    clock.advance(1);
    await stopped;
    expect((await get(id)).usage.latest?.status).toBe(AssistantTurnStatus.TimedOut);
    expect(t.fake.abort).toHaveBeenCalledTimes(2);
  });

  it('刚派发尚未开始时先等本轮启动，启动确认失败有界返回且保留忙碌，用户可以重试', async () => {
    const id = await create();
    const dispatched = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const original = t.fake.prompt.bind(t.fake);
    vi.spyOn(t.fake, 'prompt').mockImplementationOnce(async (input) => {
      dispatched.resolve();
      await release.promise;
      await original(input);
    });
    t.fake.enqueue(script().hang().text('不会到达'));
    const sending = send(id);
    await dispatched.promise;
    const stopping = t.app.services.assistant.abort(id);
    const rejected = expect(stopping).rejects.toMatchObject({ code: ErrorCode.OpencodeRequestFailed });
    clock.advance(10_000);
    await rejected;
    expect(t.fake.aborts).toEqual([]);
    expect((await get(id)).busy).toBe(true);
    expect((await send(id)).status).toBe(409);
    release.resolve();
    await sending;
    await t.call(abortAssistantOp, { id });
    expect(t.fake.aborts).toHaveLength(1);
    expect((await get(id)).usage.latest?.status).toBe(AssistantTurnStatus.Aborted);
  });

  it('停止 HTTP 超过确认期限仍锁住会话，重试等待原请求且不重复 abort', async () => {
    const id = await create();
    await hang(id);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const original = t.fake.abort.bind(t.fake);
    const abort = vi.spyOn(t.fake, 'abort').mockImplementationOnce(async (input) => {
      await original(input);
      entered.resolve();
      await release.promise;
    });
    const first = t.app.services.assistant.abort(id);
    const failed = expect(first).rejects.toMatchObject({ code: ErrorCode.OpencodeRequestFailed });
    await entered.promise;
    clock.advance(10_000);
    await failed;
    expect((await get(id)).busy).toBe(true);
    expect((await send(id)).status).toBe(409);
    const retry = t.app.services.assistant.abort(id);
    release.resolve();
    await retry;
    expect(abort).toHaveBeenCalledTimes(1);
    expect((await get(id)).usage.latest?.status).toBe(AssistantTurnStatus.Aborted);
  });

  it.each(['manual', 'timeout'] as const)('%s 停止确认超界后不重试，原请求迟到成功仍保留停止原因', async (source) => {
    await t.call(updateSettingsOp, { 'attempt.timeoutMinutes': 1 });
    const id = await create();
    await hang(id);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const original = t.fake.abort.bind(t.fake);
    vi.spyOn(t.fake, 'abort').mockImplementationOnce(async (input) => {
      await original(input);
      entered.resolve();
      await release.promise;
    });
    const failed = waitForEvent(
      t.app.events,
      ServerEventType.AssistantTranscript,
      (data) => data.conversationId === id && data.entries.some((e) => e.kind === 'error'),
    );
    const stopping = source === 'manual' ? t.app.services.assistant.abort(id).catch(() => undefined) : undefined;
    if (source === 'timeout') clock.advance(60_000);
    await entered.promise;
    clock.advance(10_000);
    await failed;
    await stopping;
    expect((await get(id)).busy).toBe(true);
    const finished = waitForEvent(
      t.app.events,
      ServerEventType.AssistantUpdated,
      (data) => data.id === id && !data.busy,
    );
    release.resolve();
    await finished;
    expect((await get(id)).usage.latest?.status).toBe(
      source === 'manual' ? AssistantTurnStatus.Aborted : AssistantTurnStatus.TimedOut,
    );
    expect(t.fake.abort).toHaveBeenCalledTimes(1);
  });

  it('权限等待时停止会取消本轮，不等用户再回答权限', async () => {
    const id = await create();
    t.fake.enqueue(script().requestPermission('bash', ['echo test']).text('不会到达'));
    const asked = waitForEvent(
      t.app.events,
      ServerEventType.AssistantUpdated,
      (data) => data.id === id && data.pendingPermissions.length > 0,
    );
    await send(id);
    await asked;
    expect((await t.call(abortAssistantOp, { id })).status).toBe(200);
    expect(await get(id)).toMatchObject({
      busy: false,
      pendingPermissions: [],
      usage: { latest: { status: AssistantTurnStatus.Aborted } },
    });
  });

  it.each([false, true])('未知 HTTP 传输失败不放行下一轮；停止迟到=%s 仍释放底层工作', async (late) => {
    const id = await create();
    const original = t.fake.promptAssistant.bind(t.fake);
    const broken = Promise.withResolvers<never>();
    vi.spyOn(t.fake, 'promptAssistant').mockImplementationOnce((input) => {
      const handle = original(input);
      return { ...handle, completed: Promise.race([handle.completed, broken.promise]) };
    });
    await hang(id);
    const failed = waitForEvent(
      t.app.events,
      ServerEventType.AssistantTranscript,
      (data) => data.conversationId === id && data.entries.some((e) => e.kind === 'error'),
    );
    broken.reject(new AppError(ErrorCode.OpencodeRequestFailed, 'connection reset'));
    await failed;
    expect((await get(id)).busy).toBe(true);
    expect((await get(id)).usage.latest?.status).toBe(AssistantTurnStatus.Running);
    expect((await send(id)).status).toBe(409);
    if (late) {
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const abort = t.fake.abort.bind(t.fake);
      vi.spyOn(t.fake, 'abort').mockImplementationOnce(async (input) => {
        await abort(input);
        entered.resolve();
        await release.promise;
      });
      const rejected = expect(t.app.services.assistant.abort(id)).rejects.toMatchObject({
        code: ErrorCode.OpencodeRequestFailed,
      });
      await entered.promise;
      clock.advance(10_000);
      await rejected;
      const stopped = waitForEvent(
        t.app.events,
        ServerEventType.AssistantUpdated,
        (data) => data.id === id && !data.busy,
      );
      release.resolve();
      await stopped;
    } else await t.call(abortAssistantOp, { id });
    expect(t.fake.aborts).toHaveLength(1);
    expect(await get(id)).toMatchObject({ busy: false, usage: { latest: { status: AssistantTurnStatus.Aborted } } });
  });
  it('中止的 HTTP 回应先到，旧 Error 与多个 Idle 随后按 SSE 顺序抵达时不结束下一轮', async () => {
    await t.close();
    const fake = createFakeOpencode();
    const subscribe = fake.subscribe.bind(fake);
    const pending: Array<() => void> = [];
    let held = false;
    const nextMessage = Promise.withResolvers<void>();
    fake.subscribe = (listener) =>
      subscribe((event) => {
        if (!held) return listener(event);
        pending.push(() => listener(event));
        if (event.type === OpencodeEventType.Message && event.role === 'assistant') nextMessage.resolve();
      });
    t = await createTestApp({ fake, clock });
    const id = await create();
    await hang(id);
    held = true;
    expect((await t.call(abortAssistantOp, { id })).status).toBe(200);
    await fake.settled();
    const session = fake.sessions[0];
    if (session === undefined) throw new Error('Expected session');
    // 真实 1.19 的 processor halt 和 runner cleanup 各发一个 Idle。
    fake.replay([{ type: OpencodeEventType.Idle, sessionId: session.id }]);
    fake.enqueue(script().text('第二轮仍在工作').hang().text('不会到达'));
    const sending = send(id);
    await nextMessage.promise;
    held = false;
    for (const deliver of pending) deliver();
    await sending;
    expect(await get(id)).toMatchObject({
      busy: true,
      usage: { turns: 2, latest: { status: AssistantTurnStatus.Running, tokensInput: null } },
    });
    expect(t.app.services.assistant.transcript(id, 0).entries.filter((entry) => entry.kind === 'error')).toEqual([]);
    await t.call(abortAssistantOp, { id });
  });
});
