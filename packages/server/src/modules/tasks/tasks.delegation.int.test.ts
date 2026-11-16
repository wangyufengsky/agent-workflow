import { basename } from 'node:path';
import {
  AttemptKind,
  AttemptStatus,
  cancelTaskOp,
  DELEGATION_READ_MAX_CHARS,
  DELEGATION_TIMEOUT_MS,
  ErrorCode,
  getAttemptOp,
  getTaskTimelineOp,
  OPENCODE_AGENT_NAME,
  ServerEventType,
  SessionAgent,
  updateSettingsOp,
} from '@aw/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createFakeClock, type FakeClock } from '../../../test/helpers/clock.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, createTask, taskReaches } from '../../../test/helpers/tasks.ts';

let t: TestApp;
let clock: FakeClock;
beforeEach(async () => {
  clock = createFakeClock();
  t = await createTestApp({ clock });
});
afterEach(() => t.close());

const child = { agent: OPENCODE_AGENT_NAME[SessionAgent.Delegate] };
const parent = { title: '· 定位根因' };

function finishTask() {
  t.fake.enqueue(script().callTool('submit_result', { summary: '修复' }), { title: '· 修复' });
  t.fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: '通过' }), { agent: 'aw-reviewer' });
}

it('两个委派读取同一个固定 Git 快照，返回证据，父节点继续并可追踪子尝试', async () => {
  await t.call(updateSettingsOp, { 'scheduler.maxConcurrentAttempts': 4 });
  const prefix = 'a'.repeat(DELEGATION_READ_MAX_CHARS - 1);
  const longLine = `${prefix}🚀tail`;
  const { project } = await addProject(t, {
    checkCommand: null,
    files: { 'src/a.txt': 'committed needle\nsecond\n', 'src/long.txt': longLine },
  });
  const inspect = () =>
    script()
      .callTool('inspect_delegation', { action: 'search', query: 'needle', path: 'src' })
      .callTool('inspect_delegation', { action: 'read', path: 'src/a.txt' })
      .callTool('inspect_delegation', { action: 'read', path: 'src/long.txt' })
      .callTool('inspect_delegation', {
        action: 'read',
        path: 'src/long.txt',
        startLine: 1,
        startOffset: prefix.length,
      })
      .callTool('inspect_delegation', { action: 'read', path: '../outside' })
      .callTool('get_task_context')
      .callTool('delegate_readonly', { questions: ['nested'] })
      .callTool('submit_delegation', { summary: 'src/a.txt:1 contains the committed marker' });
  t.fake.enqueue(inspect(), child);
  t.fake.enqueue(inspect(), child);
  t.fake.enqueue(
    script()
      .edit('src/a.txt', 'uncommitted marker\n')
      .callTool('delegate_readonly', { questions: ['查找入口', '核对证据'] })
      .callTool('delegate_readonly', { questions: ['超出额度'] })
      .callTool('submit_result', { summary: '定位完成' }),
    parent,
  );
  finishTask();
  const review = taskReaches(t, 'review');
  const task = await createTask(t, { projectId: project.id, workflow: 'bugfix' });
  await review;
  await t.fake.settled();

  const childSessions = t.fake.sessions.filter((session) => session.agent === child.agent);
  expect(childSessions).toHaveLength(2);
  expect(childSessions.every((session) => basename(session.directory).startsWith('aw-delegate-'))).toBe(true);
  const childIds = new Set(childSessions.map((session) => session.id));
  const returned = t.fake.toolCalls.filter((call) => call.name === 'delegate_readonly');
  const parentCalls = returned.filter((call) => !childIds.has(call.sessionId));
  expect(parentCalls[0]?.result).toMatchObject({
    commit: expect.any(String),
    results: ['查找入口', '核对证据'].map((question) => ({
      question,
      status: 'succeeded',
      attemptId: expect.any(String),
      sources: [
        { path: 'src/a.txt', startLine: 1, endLine: 3 },
        { path: 'src/long.txt', startLine: 1, endLine: 1 },
      ],
    })),
  });
  expect(parentCalls[1]?.result).toMatchObject({ code: ErrorCode.ValidationFailed });
  for (const id of childIds) {
    const calls = t.fake.toolCalls.filter((call) => call.sessionId === id);
    const reads = calls.filter((call) => call.name === 'inspect_delegation');
    expect(reads.map((call) => call.result)).toEqual([
      expect.objectContaining({ paths: ['src/a.txt'] }),
      expect.objectContaining({ text: 'committed needle\nsecond\n' }),
      expect.objectContaining({ text: prefix, truncated: true, nextLine: 1, nextOffset: prefix.length }),
      expect.objectContaining({ text: '🚀tail' }),
      expect.objectContaining({ code: ErrorCode.ValidationFailed }),
    ]);
    for (const operation of ['get_task_context', 'delegate_readonly']) {
      expect(calls.find((call) => call.name === operation)?.result).toMatchObject({
        code: ErrorCode.McpToolNotAllowed,
      });
    }
  }
  const timeline = (await t.call(getTaskTimelineOp, { id: task.id })).body.items;
  const notes = timeline.filter((event) => event.payload !== null && 'parentAttemptId' in event.payload);
  expect(notes).toHaveLength(2);
  expect(new Set(notes.map((event) => event.payload?.parentAttemptId)).size).toBe(1);
});

it('没有空余模型槽时返回可辨认的结果，任务可继续', async () => {
  await t.call(updateSettingsOp, { 'scheduler.maxConcurrentAttempts': 1 });
  const { project } = await addProject(t, { checkCommand: null });
  t.fake.enqueue(
    script()
      .callTool('delegate_readonly', { questions: ['定位调用者'] })
      .callTool('submit_result', { summary: '本节点完成' }),
    parent,
  );
  finishTask();
  const review = taskReaches(t, 'review');
  await createTask(t, { projectId: project.id, workflow: 'bugfix' });
  await review;
  expect(t.fake.toolCalls.find((call) => call.name === 'delegate_readonly')?.result).toMatchObject({
    results: [{ question: '定位调用者', status: 'unavailable', reason: 'model_slots_busy' }],
  });
  expect(t.fake.sessions.some((session) => session.agent === child.agent)).toBe(false);
});

it('取消任务结束正在工作的委派', async () => {
  await t.call(updateSettingsOp, { 'scheduler.maxConcurrentAttempts': 3 });
  const { project } = await addProject(t, { checkCommand: null });
  t.fake.enqueue(script().hang(), child);
  t.fake.enqueue(script().callTool('delegate_readonly', { questions: ['需要取消的调查'] }), parent);
  const runningChild = waitForEvent(
    t.app.events,
    ServerEventType.AttemptUpdated,
    (event) => event.attempt.kind === AttemptKind.Delegation && event.attempt.status === AttemptStatus.Running,
  );
  const task = await createTask(t, { projectId: project.id, workflow: 'bugfix' });
  const { attempt } = await runningChild;
  expect((await t.call(cancelTaskOp, { id: task.id })).status).toBe(200);
  await t.fake.settled();
  expect((await t.call(getAttemptOp, { id: attempt.id })).body.status).toBe(AttemptStatus.Aborted);
  expect(t.fake.toolCalls.find((call) => call.name === 'delegate_readonly')?.result).toMatchObject({
    results: [{ attemptId: attempt.id, status: 'failed' }],
  });
});

it('委派超时结束子尝试，父节点仍可完成', async () => {
  const { project } = await addProject(t, { checkCommand: null });
  t.fake.enqueue(script().hang(), child);
  t.fake.enqueue(
    script()
      .callTool('delegate_readonly', { questions: ['耗时调查'] })
      .callTool('submit_result', { summary: '父节点继续' }),
    parent,
  );
  finishTask();
  const review = taskReaches(t, 'review');
  const active = waitForEvent(
    t.app.events,
    ServerEventType.AttemptUpdated,
    (event) => event.attempt.kind === AttemptKind.Delegation && event.attempt.status === AttemptStatus.Running,
  );
  await createTask(t, { projectId: project.id, workflow: 'bugfix' });
  const { attempt } = await active;
  clock.advance(DELEGATION_TIMEOUT_MS);
  await review;
  expect((await t.call(getAttemptOp, { id: attempt.id })).body.status).toBe(AttemptStatus.Aborted);
  expect(t.fake.toolCalls.find((call) => call.name === 'delegate_readonly')?.result).toMatchObject({
    results: [{ attemptId: attempt.id, status: 'failed', reason: 'timeout' }],
  });
});
