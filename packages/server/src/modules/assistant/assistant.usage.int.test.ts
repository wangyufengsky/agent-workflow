import { readFileSync } from 'node:fs';
import {
  AssistantPage,
  AssistantTurnEvent,
  AssistantTurnStatus,
  abortAssistantOp,
  createConversationOp,
  getConversationOp,
  replyAssistantPermissionOp,
  ServerEventType,
  sendAssistantMessageOp,
  updateSettingsOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
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
    const replay = { ...first, sessionId: message.sessionId, messageId: message.messageId };
    t.fake.replay([replay, replay]);
    expect((await get(id)).usage.tokensInput).toBe(first.tokens.input);
    await t.call(abortAssistantOp, { id });
    await t.fake.settled();
    t.fake.enqueue(script().usage(5, 2));
    await send(id);
    await t.fake.settled();
    // 旧消息的另一条迟到 step 仍归旧轮；再次重放同一条不会增加。
    const late = { ...replay, partId: `${replay.partId}-late` };
    t.fake.replay([replay, late, late]);
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
    const pending = send(id);
    await entered.promise;
    clock.advance(60_000);
    release.resolve();
    await pending;
    expect((await get(id)).usage.latest?.status).toBe(AssistantTurnStatus.TimedOut);
    expect(t.fake.prompts).toEqual([]);
  });

  it('超时停止请求失败时保留忙碌，不谎报停止，也不自动重试', async () => {
    await t.call(updateSettingsOp, { 'attempt.timeoutMinutes': 1 });
    const id = await create();
    await hang(id);
    vi.spyOn(t.fake, 'abort').mockRejectedValueOnce(new Error('abort unavailable'));
    const failed = waitForEvent(
      t.app.events,
      ServerEventType.AssistantUpdated,
      (c) => c.id === id && c.usage.latest?.status === AssistantTurnStatus.Failed,
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
});
