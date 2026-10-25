import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type AttemptStatus,
  abortAttemptOp,
  ErrorCode,
  getAttemptOp,
  ServerEventType,
  startDebugAttemptOp,
  updateSettingsOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createFakeClock, type FakeClock } from '../../../test/helpers/clock.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { createTestRepo, type TestRepo } from '../../../test/helpers/git.ts';

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
