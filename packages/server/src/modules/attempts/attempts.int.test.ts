import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AttemptKind,
  type AttemptStatus,
  abortAttemptOp,
  ErrorCode,
  getAttemptOp,
  getModelSlotsOp,
  InboxKind,
  PermissionDecision,
  RoleBaseAgent,
  resolveInboxOp,
  ServerEventType,
  startDebugAttemptOp,
  TranscriptSystemEvent,
  updateRoleOp,
  updateSettingsOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createFakeClock, type FakeClock } from '../../../test/helpers/clock.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { createTestRepo, type TestRepo } from '../../../test/helpers/git.ts';
import { inboxOpens } from '../../../test/helpers/tasks.ts';
import { OpencodeEventType } from '../opencode/index.ts';

let t: TestApp;
let clock: FakeClock;
let repo: TestRepo;

beforeEach(async () => {
  clock = createFakeClock();
  t = await createTestApp({ clock });
  repo = await createTestRepo();
});
afterEach(() => t.close());

const reaches = (status: AttemptStatus) =>
  waitForEvent(t.app.events, ServerEventType.AttemptUpdated, (d) => d.attempt.status === status);

async function startAttempt() {
  const res = await t.call(startDebugAttemptOp, { directory: repo.path, requirement: 'Add a greeting file' });
  expect(res.status).toBe(201);
  return res.body;
}

const submit = { summary: 'Added hello.txt', changes: [{ path: 'hello.txt', description: 'greeting' }] };

describe('尝试的结束条件（12 §4.2）', () => {
  it('执行角色的模型、独立强度和跟随全局分别进入任务请求', async () => {
    const model = 'opencode/fake-model';
    const global = { model, variant: 'deep' };
    await t.call(updateSettingsOp, { 'ai.defaultModel': model, 'ai.defaultEffort': global });
    const role = t.app.services.roles.getByKey('developer');
    for (const choice of [null, { model, variant: 'low' }, { model, variant: null }]) {
      await t.call(updateRoleOp, { id: role.id, effort: choice });
      t.fake.enqueue(script().stall());
      const started = await t.app.services.attempts.start({
        kind: AttemptKind.Execute,
        taskId: null,
        nodeId: null,
        projectId: null,
        roleId: role.id,
        agent: RoleBaseAgent.Executor,
        directory: repo.path,
        title: 'Effort probe',
        model,
        prompt: 'Check effort.',
      });
      expect(t.fake.prompts.at(-1)?.efforts?.find((e) => e.model === model)).toEqual(choice ?? global);
      await t.app.services.attempts.abort(started.id);
    }
  });

  it('提交结果后成功，并中止会话后续的生成', async () => {
    t.fake.enqueue(script().edit('hello.txt', 'hi\n').callTool('submit_result', submit).text('Done.'));
    const succeeded = reaches('succeeded');
    const started = await startAttempt();
    expect(started).toMatchObject({ status: 'running', kind: 'execute', seq: 1, directory: repo.path });

    await succeeded;
    await t.fake.settled();
    expect(await readFile(join(repo.path, 'hello.txt'), 'utf8')).toBe('hi\n');
    expect(t.fake.toolCalls).toEqual([
      {
        sessionId: started.opencodeSessionId,
        name: 'submit_result',
        isError: false,
        result: { accepted: true, next: 'done' },
      },
    ]);
    // The submit call has returned by now, so the session is stopped.
    expect(t.fake.aborts).toEqual([started.opencodeSessionId]);
  });

  it('已接受的提交保留成功结果，迟来的预算阻断与空闲不再派发', async () => {
    const succeeded = reaches('succeeded');
    t.fake.enqueue(script().callTool('submit_result', submit));
    const started = await startAttempt();
    await succeeded;
    const sessionId = started.opencodeSessionId;
    if (!sessionId) throw new Error('Missing session');
    t.app.services.attempts.blockContext(sessionId, started.id);
    t.fake.replay([
      { type: OpencodeEventType.Error, sessionId, error: undefined },
      { type: OpencodeEventType.Idle, sessionId },
    ]);
    await t.fake.settled();
    expect((await t.call(getAttemptOp, { id: started.id })).body).toMatchObject({
      status: 'succeeded',
      error: null,
      nudges: 0,
    });
    expect(t.fake.toolCalls).toHaveLength(1);
    expect(t.fake.prompts).toHaveLength(1);
  });

  it('空闲且未提交时提醒一次，再次空闲仍未提交则失败 ATTEMPT_NO_RESULT', async () => {
    const failed = reaches('failed');
    const started = await startAttempt();
    const attempt = await failed;

    expect(attempt.attempt).toMatchObject({ nudges: 1, error: { code: ErrorCode.AttemptNoResult } });
    // Usage of both turns is summed on the attempt.
    expect((await t.call(getAttemptOp, { id: started.id })).body).toMatchObject({ tokensInput: 200, tokensOutput: 40 });
    expect(t.fake.prompts.map((p) => p.text)).toEqual([
      expect.stringContaining('Add a greeting file'),
      expect.stringContaining('agent-workflow_submit_result'),
    ]);
    expect(t.fake.prompts[1]).toMatchObject({ sessionId: started.opencodeSessionId, agent: 'aw-executor' });
  });

  it('提醒后提交结果则成功', async () => {
    t.fake.enqueue(script().text('I think I am done.'));
    t.fake.enqueue(script().callTool('submit_result', submit));
    const succeeded = reaches('succeeded');
    await startAttempt();
    expect((await succeeded).attempt).toMatchObject({ nudges: 1, error: null });
    await t.fake.settled();
  });

  it('会话报错时失败 ATTEMPT_SESSION_ERROR', async () => {
    t.fake.enqueue(script().error('APIError', 'Bad Gateway'));
    const failed = reaches('failed');
    await startAttempt();
    expect((await failed).attempt.error).toEqual({
      code: ErrorCode.AttemptSessionError,
      // The model service's own words, not just the error's class (D163).
      message: 'APIError: Bad Gateway',
      details: { error: { name: 'APIError', data: { message: 'Bad Gateway' } } },
    });
  });

  it.each(['summary-fails', 'overflows-again'])('原生恢复失败后原尝试干净停止（%s）', async (scenario) => {
    await t.call(updateSettingsOp, { 'ai.contextEngine': true });
    t.fake.enqueue(script().hang());
    const started = await startAttempt();
    const sessionId = started.opencodeSessionId;
    if (!sessionId) throw new Error('Missing session');
    let summaries = 0;
    t.fake.summarizeSession = async () => {
      summaries++;
      if (scenario === 'summary-fails') throw new Error('Compaction failed');
      t.fake.replay([
        { type: OpencodeEventType.Compacted, sessionId },
        { type: OpencodeEventType.Idle, sessionId },
      ]);
    };
    t.app.services.attempts.manageContext(sessionId, 'opencode/fake-model');
    t.fake.enqueue(script().error('ContextOverflowError', 'context length exceeded'));
    const failed = reaches('failed');
    t.fake.replay([
      {
        type: OpencodeEventType.Error,
        sessionId,
        error: { name: 'ContextOverflowError', data: { message: 'context length exceeded' } },
      },
      { type: OpencodeEventType.Idle, sessionId },
    ]);
    expect((await failed).attempt).toMatchObject({
      id: started.id,
      nudges: 0,
      error: { code: ErrorCode.AttemptContextBudget },
    });
    expect(summaries).toBe(1);
    expect(t.fake.prompts.map((p) => p.sessionId)).toEqual(
      scenario === 'summary-fails' ? [sessionId] : [sessionId, sessionId],
    );
    expect((await t.call(getModelSlotsOp, {})).body.inUse).toBe(0);
  });

  it('续跑得到成功工具步骤后，下一次真实超窗可再次恢复', async () => {
    await t.call(updateSettingsOp, { 'ai.contextEngine': true });
    t.fake.enqueue(script().hang());
    const started = await startAttempt(),
      sessionId = started.opencodeSessionId;
    if (!sessionId) throw new Error('Missing session');
    const resumed = Promise.withResolvers<string>();
    const unwatch = t.fake.subscribe((e) => {
      if (
        e.type === OpencodeEventType.Message &&
        e.sessionId === sessionId &&
        e.role === 'assistant' &&
        e.parentMessageId
      )
        resumed.resolve(e.messageId);
    });
    const overflow = () =>
      t.fake.replay([
        {
          type: OpencodeEventType.Error,
          sessionId,
          error: { name: 'ContextOverflowError', data: { message: 'overflow' } },
        },
        { type: OpencodeEventType.Idle, sessionId },
      ]);
    t.app.services.attempts.manageContext(sessionId, 'opencode/fake-model');
    t.fake.enqueue(script().hang());
    overflow();
    const messageId = await resumed.promise;
    unwatch();
    t.fake.replay([
      {
        type: OpencodeEventType.StepFinished,
        sessionId,
        messageId,
        partId: 'progress',
        reason: 'tool-calls',
        tokens: { input: 24, output: 5 },
        cost: 0,
      },
    ]);
    const done = reaches('succeeded');
    t.fake.enqueue(script().callTool('submit_result', submit));
    overflow();
    expect((await done).attempt).toMatchObject({ id: started.id, nudges: 0 });
    expect(t.fake.prompts.map((p) => p.sessionId)).toEqual([sessionId, sessionId, sessionId]);
  });
  it('原生恢复期间取消立即释放会话，迟到的摘要不能再发送', async () => {
    await t.call(updateSettingsOp, { 'ai.contextEngine': true });
    t.fake.enqueue(script().hang());
    const started = await startAttempt(),
      sessionId = started.opencodeSessionId;
    if (!sessionId) throw new Error('Missing session');
    const entered = Promise.withResolvers<void>(),
      reply = Promise.withResolvers<void>();
    t.fake.summarizeSession = async () => {
      entered.resolve();
      return reply.promise;
    };
    t.app.services.attempts.manageContext(sessionId, 'opencode/fake-model');
    t.fake.replay([
      {
        type: OpencodeEventType.Error,
        sessionId,
        error: { name: 'ContextOverflowError', data: { message: 'overflow' } },
      },
      { type: OpencodeEventType.Idle, sessionId },
    ]);
    await entered.promise;
    await t.call(abortAttemptOp, { id: started.id });
    reply.resolve();
    await t.fake.settled();
    expect(t.app.services.attempts.liveAgentOf(started.id)).toBeUndefined();
    expect(t.fake.prompts).toHaveLength(1);
    expect((await t.call(getModelSlotsOp, {})).body.inUse).toBe(0);
  });

  it.each(['idle-first', 'error-first'])('预算阻断后只结束当前尝试（%s）', async (order) => {
    t.fake.enqueue(script().hang());
    const started = await startAttempt();
    const sessionId = started.opencodeSessionId;
    if (!sessionId) throw new Error('Missing session');
    t.app.services.attempts.blockContext(sessionId, started.id);
    const idle = { type: OpencodeEventType.Idle, sessionId } as const;
    const error = {
      type: OpencodeEventType.Error,
      sessionId,
      error: { name: 'UnknownError', data: { message: 'AW context budget exceeded' } },
    } as const;
    t.fake.replay(order === 'idle-first' ? [idle, error] : [error, idle]);
    const attempt = (await t.call(getAttemptOp, { id: started.id })).body;
    expect(attempt).toMatchObject({ nudges: 0, status: 'failed', error: { code: ErrorCode.AttemptContextBudget } });
    expect(t.fake.prompts).toHaveLength(1);
    expect((await t.call(getModelSlotsOp, {})).body).toMatchObject({ inUse: 0, queued: 0 });
  });

  it('预算阻断后保留未决审批，答复后结束且不催办', async () => {
    const opened = inboxOpens(t, InboxKind.Permission);
    t.fake.enqueue(script().requestPermission('webfetch', ['https://example.com']).hang());
    const started = await startAttempt();
    const { item } = await opened;
    const sessionId = started.opencodeSessionId;
    if (!sessionId) throw new Error('Missing session');
    t.app.services.attempts.blockContext(sessionId, started.id);
    t.fake.replay([
      { type: OpencodeEventType.Error, sessionId, error: undefined },
      { type: OpencodeEventType.Idle, sessionId },
    ]);
    expect(t.app.services.inbox.listOpen({ attemptId: started.id })).toMatchObject([{ id: item.id }]);
    expect((await t.call(getModelSlotsOp, {})).body.inUse).toBe(0);
    const failed = reaches('failed');
    await t.call(resolveInboxOp, { id: item.id, response: { decision: PermissionDecision.Once } });
    expect((await failed).attempt).toMatchObject({ nudges: 0, error: { code: ErrorCode.AttemptContextBudget } });
    expect(t.fake.prompts).toHaveLength(1);
  });

  it('上下文超限后等到原会话空闲，压缩未成功则保留原始错误', async () => {
    const overflow = 'context too long';
    t.fake.enqueue(script().error('ContextOverflowError', overflow, { idle: false }));
    const notice = waitForEvent(t.app.events, ServerEventType.AttemptTranscript, (d) =>
      d.entries.some((e) => e.kind === 'system' && e.data.event === TranscriptSystemEvent.ContextOverflow),
    );
    const attempt = await startAttempt();
    await notice;
    if (attempt.opencodeSessionId === null) throw new Error('Missing OpenCode session');
    expect((await t.call(getAttemptOp, { id: attempt.id })).body).toMatchObject({ status: 'running', error: null });
    expect(t.fake.prompts).toHaveLength(1);

    const failed = reaches('failed');
    t.fake.replay([{ type: OpencodeEventType.Idle, sessionId: attempt.opencodeSessionId }]);
    expect((await failed).attempt).toMatchObject({
      id: attempt.id,
      nudges: 0,
      error: { code: ErrorCode.AttemptSessionError, message: `ContextOverflowError: ${overflow}` },
    });
    expect(t.fake.prompts).toHaveLength(1);
  });

  it('压缩成功后空闲且未提交时，在原会话照常提醒提交', async () => {
    t.fake.enqueue(script().error('ContextOverflowError', 'context too long', { endTurn: false }).compacted());
    t.fake.enqueue(script().callTool('submit_result', submit));
    const succeeded = reaches('succeeded');
    const attempt = await startAttempt();
    expect((await succeeded).attempt).toMatchObject({ id: attempt.id, nudges: 1, error: null });

    expect(t.fake.prompts.map(({ sessionId }) => sessionId)).toEqual([
      attempt.opencodeSessionId,
      attempt.opencodeSessionId,
    ]);
  });

  it('模型服务不可用、opencode 重试期间不计入超时，恢复后照常计时（D163）', async () => {
    await t.call(updateSettingsOp, { 'attempt.timeoutMinutes': 5 });
    const down = 'Cannot connect to API: Unable to connect. Is the computer able to access the url?';
    const busy = 'Service Unavailable: no healthy upstream';
    t.fake.enqueue(script().retry(down, down, busy).text('Back again').hang());
    const retries: Array<string | undefined> = [];
    t.app.events.subscribe((event) => {
      if (event.type !== ServerEventType.AttemptTranscript) return;
      for (const e of event.data.entries)
        if (e.kind === 'system' && e.data.event === 'retrying') retries.push(e.data.detail);
    });
    const waiting = waitForEvent(t.app.events, ServerEventType.AttemptTranscript, (d) =>
      d.entries.some((e) => e.kind === 'system' && e.data.detail === busy),
    );
    const started = await startAttempt();
    await waiting;

    clock.advance(60 * 60_000);
    expect((await t.call(getAttemptOp, { id: started.id })).body.status).toBe('running');
    // Each reason is recorded once while opencode keeps retrying with it.
    expect(retries).toEqual([down, busy]);

    const back = waitForEvent(t.app.events, ServerEventType.AttemptTranscript, (d) =>
      d.entries.some((e) => e.kind === 'text'),
    );
    t.fake.recoverModel();
    await back;
    clock.advance(5 * 60_000 - 1);
    expect((await t.call(getAttemptOp, { id: started.id })).body.status).toBe('running');
    const failed = reaches('failed');
    clock.advance(1);
    expect((await failed).attempt.error).toMatchObject({ code: ErrorCode.AttemptTimeout });
  });

  it('模型服务长时间没有返回数据时中止这次输出，提醒它分段写后在同一会话继续（D217）', async () => {
    t.fake.enqueue(script().text('Now I will write the whole document').stall());
    t.fake.enqueue(script().edit('hello.txt', 'hi\n').callTool('submit_result', submit));
    const entries: Array<{ kind: string; data: unknown }> = [];
    t.app.events.subscribe((event) => {
      if (event.type === ServerEventType.AttemptTranscript) entries.push(...event.data.entries);
    });
    const succeeded = reaches('succeeded');
    const started = await startAttempt();

    expect((await succeeded).attempt).toMatchObject({ nudges: 0, error: null });
    expect(t.fake.aborts[0]).toBe(started.opencodeSessionId);
    expect(t.fake.prompts[1]).toMatchObject({
      sessionId: started.opencodeSessionId,
      text: expect.stringContaining('in parts'),
    });
    expect(entries).toContainEqual(expect.objectContaining({ kind: 'system', data: { event: 'model_stalled' } }));
    // The abort was ours, not a failure of the session.
    expect(entries.filter((e) => e.kind === 'error')).toEqual([]);
    await t.fake.settled();
  });

  it('超过 attempt.timeoutMinutes 时中止会话并失败 ATTEMPT_TIMEOUT', async () => {
    await t.call(updateSettingsOp, { 'attempt.timeoutMinutes': 5 });
    t.fake.enqueue(script().text('Working on it').hang());
    const working = waitForEvent(t.app.events, ServerEventType.AttemptTranscript, (d) =>
      d.entries.some((e) => e.kind === 'text'),
    );
    const started = await startAttempt();
    await working;

    clock.advance(5 * 60_000 - 1);
    expect((await t.call(getAttemptOp, { id: started.id })).body.status).toBe('running');
    const failed = reaches('failed');
    clock.advance(1);
    expect((await failed).attempt.error).toMatchObject({ code: ErrorCode.AttemptTimeout });
    expect(t.fake.aborts).toEqual([started.opencodeSessionId]);
  });

  it('用户中止进行中的尝试', async () => {
    t.fake.enqueue(script().requestPermission('webfetch', ['https://example.com']));
    const started = await startAttempt();
    const res = await t.call(abortAttemptOp, { id: started.id });
    expect(res.body).toMatchObject({ status: 'aborted', endedAt: clock.now() });
    expect(t.fake.aborts).toEqual([started.opencodeSessionId]);
    expect((await t.call(abortAttemptOp, { id: started.id })).body).toMatchObject({
      error: { code: ErrorCode.StateTransitionInvalid },
    });
  });

  it('opencode 运行时消失时活动尝试变为 interrupted', async () => {
    t.fake.enqueue(script().requestPermission('bash', ['sleep 100']));
    const started = await startAttempt();
    const interrupted = reaches('interrupted');
    t.fake.crash();
    expect((await interrupted).attempt.id).toBe(started.id);
  });

  it('后端重启时把上次未结束的尝试标为 interrupted', async () => {
    t.fake.enqueue(script().requestPermission('bash', ['sleep 100']));
    const started = await startAttempt();
    await t.close();

    t = await createTestApp({ clock, dataDir: t.dataDir });
    expect((await t.call(getAttemptOp, { id: started.id })).body).toMatchObject({ status: 'interrupted' });
  });

  it('opencode 未就绪时不创建尝试', async () => {
    t.fake.crash();
    const res = await t.call(startDebugAttemptOp, { directory: repo.path, requirement: 'x' });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: { code: ErrorCode.OpencodeNotReady } });
  });
});

describe('离线环境不显示费用（D181）', () => {
  /** Two turns without a result: the first reports a cost, the nudged second the default usage. */
  async function usedAttempt() {
    t.fake.enqueue(script().usage(100, 20, 0.25));
    const failed = reaches('failed');
    const started = await startAttempt();
    await failed;
    return started.id;
  }

  it('在线时（对照）：尝试带上 opencode 报告的费用', async () => {
    const id = await usedAttempt();
    expect((await t.call(getAttemptOp, { id })).body).toMatchObject({ tokensInput: 200, tokensOutput: 40, cost: 0.25 });
  });

  it('打开离线环境后：尝试只有 tokens，费用为 null', async () => {
    const id = await usedAttempt();
    await t.call(updateSettingsOp, { 'network.offline': true });
    expect((await t.call(getAttemptOp, { id })).body).toMatchObject({ tokensInput: 200, tokensOutput: 40, cost: null });
  });
});
