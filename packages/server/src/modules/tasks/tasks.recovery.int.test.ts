import { getNodeOp, getTaskOp, resolveInboxOp, ServerEventType } from '@aw/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeOpencode, script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import {
  addProject,
  createTask,
  finalVerify,
  nodeReaches,
  planArgs,
  taskReaches,
} from '../../../test/helpers/tasks.ts';

const fake = createFakeOpencode();
let t: TestApp;
afterEach(() => t.close());

/** The backend exits (no state transitions on the way out) and starts again on the same data; opencode keeps its sessions. */
async function restart(): Promise<void> {
  await t.close();
  t = await createTestApp({ dataDir: t.dataDir, fake });
}

const locate = { title: '定位根因' };

/** Quitting the app: the backend shuts down (and stops opencode) while opencode still reports to it. */
async function quit(): Promise<void> {
  await t.app.close();
  await t.fake.close();
}

describe('退出应用（09 §4，D73）', () => {
  it('运行中的尝试记为 interrupted，步骤回到 ready、不消耗预算；重新打开后重跑', async () => {
    t = await createTestApp({ fake });
    const { project } = await addProject(t, { checkCommand: null });
    fake.enqueue(script().hang(), locate);
    const running = nodeReaches(t, 'locate', 'running');
    const task = await createTask(t, { projectId: project.id, workflow: 'bugfix', requirement: 'Quit while running' });
    await running;

    const interrupted = waitForEvent(
      t.app.events,
      ServerEventType.AttemptUpdated,
      (d) => d.attempt.status === 'interrupted',
    );
    const ready = nodeReaches(t, 'locate', 'ready');
    await quit();
    await interrupted;
    await ready;

    fake.enqueue(script().callTool('submit_result', { summary: 'Located after reopening' }), locate);
    fake.enqueue(script().callTool('submit_result', { summary: 'Fixed' }), { title: '· 修复' });
    fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: 'ok' }), { agent: 'aw-reviewer' });
    t = await createTestApp({ dataDir: t.dataDir, fake });
    await taskReaches(t, 'review');
    const { body } = await t.call(getTaskOp, { id: task.id });
    const { body: node } = await t.call(getNodeOp, { id: task.id, nodeId: body.nodes[0]?.id ?? '' });
    expect(node).toMatchObject({ status: 'done', attemptCount: 1 });
    expect(node.attempts.map((a) => a.status)).toEqual(['interrupted', 'succeeded']);
  });

  it('会话还在创建时退出：创建请求随 opencode 失败，尝试仍是 interrupted 而不是 failed', async () => {
    t = await createTestApp({ fake });
    const { project } = await addProject(t, { checkCommand: null });
    fake.holdSessions();
    const starting = waitForEvent(t.app.events, ServerEventType.AttemptUpdated, (d) => d.attempt.status === 'starting');
    const task = await createTask(t, { projectId: project.id, workflow: 'bugfix', requirement: 'Quit while starting' });
    await starting;

    const { logs } = t;
    await quit();
    // The failed request is part of the interruption, not an error of the backend.
    expect(logs.filter((l) => l.level >= 50).map((l) => l.msg)).toEqual([]);
    fake.enqueue(script().callTool('submit_result', { summary: 'Located after reopening' }), locate);
    fake.enqueue(script().callTool('submit_result', { summary: 'Fixed' }), { title: '· 修复' });
    fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: 'ok' }), { agent: 'aw-reviewer' });
    t = await createTestApp({ dataDir: t.dataDir, fake });
    await taskReaches(t, 'review');
    const { body } = await t.call(getTaskOp, { id: task.id });
    const { body: node } = await t.call(getNodeOp, { id: task.id, nodeId: body.nodes[0]?.id ?? '' });
    expect(node).toMatchObject({ status: 'done', attemptCount: 1 });
    expect(node.attempts.map((a) => a.status)).toEqual(['interrupted', 'succeeded']);
  });
});

describe('重启恢复（03 §2.1、09 §3）', () => {
  it('进行中的尝试标为中断，节点回到 ready（不消耗预算）并重新派发', async () => {
    t = await createTestApp({ fake });
    const { project } = await addProject(t, { checkCommand: null });
    fake.enqueue(script().hang(), locate);
    const running = nodeReaches(t, 'locate', 'running');
    const task = await createTask(t, { projectId: project.id, workflow: 'bugfix', requirement: 'Recover me' });
    await running;

    fake.enqueue(script().callTool('submit_result', { summary: 'Located after restart' }), locate);
    fake.enqueue(script().callTool('submit_result', { summary: 'Fixed' }), { title: '· 修复' });
    fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: 'ok' }), { agent: 'aw-reviewer' });
    await restart();
    const review = taskReaches(t, 'review');
    await review;

    const { body } = await t.call(getTaskOp, { id: task.id });
    const { body: node } = await t.call(getNodeOp, { id: task.id, nodeId: body.nodes[0]?.id ?? '' });
    expect(node).toMatchObject({ status: 'done', attemptCount: 1 });
    expect(node.attempts.map((a) => a.status)).toEqual(['interrupted', 'succeeded']);
  });

  it('等待阻塞问题答案的节点保持 waiting_input；重启后作答，答案发回原会话并继续', async () => {
    t = await createTestApp({ fake });
    const { project } = await addProject(t, { checkCommand: null });
    fake.enqueue(script().ask({ question: 'Which env?', blocking: true }), locate);
    const waiting = nodeReaches(t, 'locate', 'waiting_input');
    const task = await createTask(t, { projectId: project.id, workflow: 'bugfix', requirement: 'Ask me' });
    await waiting;
    const session = fake.prompts.at(-1)?.sessionId;

    await restart();
    const { body: after } = await t.call(getTaskOp, { id: task.id });
    expect(after.nodes[0]?.status).toBe('waiting_input');
    expect(after.activeAttempts.map((a) => a.status)).toEqual(['running']);
    const [question] = after.openInbox;

    fake.enqueue(script().callTool('submit_result', { summary: 'Used staging' }), locate);
    const done = nodeReaches(t, 'locate', 'done');
    await t.call(resolveInboxOp, { id: question?.id ?? '', response: { answer: 'staging' } });
    await done;
    expect(fake.prompts.at(-1)).toMatchObject({
      sessionId: session,
      agent: 'aw-executor',
      system: expect.stringContaining('Role: developer'),
      text: expect.stringContaining('Answer: staging'),
    });
  });

  it('规划会话中断后重新开始规划', async () => {
    t = await createTestApp({ fake });
    const { project } = await addProject(t, { checkCommand: null });
    fake.enqueue(script().hang(), { agent: 'aw-planner' });
    const planning = waitForEvent(t.app.events, ServerEventType.AttemptUpdated, (d) => d.attempt.status === 'running');
    const task = await createTask(t, { projectId: project.id, workflow: 'feature', requirement: 'Plan again' });
    await planning;

    fake.enqueue(script().callTool('submit_plan', planArgs([{ key: 'a' }, finalVerify(['a'])])), {
      agent: 'aw-planner',
    });
    fake.enqueue(script().hang(), { title: '· a' });
    await restart();
    const running = taskReaches(t, 'running');
    await running;
    expect((await t.call(getTaskOp, { id: task.id })).body.plan).toMatchObject({ version: 1, status: 'confirmed' });
    expect(fake.sessions.filter((s) => s.agent === 'aw-planner').map((s) => s.title)).toEqual([
      'T-1 · Plan again',
      'T-1 · Plan again',
    ]);
  });
});
