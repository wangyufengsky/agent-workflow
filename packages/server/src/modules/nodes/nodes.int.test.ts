import {
  abortAttemptOp,
  acceptNodeOp,
  ErrorCode,
  getNodeOp,
  getTaskOp,
  rejectNodeOp,
  ServerEventType,
  updateSettingsOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, createTask, inboxOpens, nodeReaches, taskReaches } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const submit = (summary: string) => script().callTool('submit_result', { summary });
const locate = { title: '定位根因' };
const fix = { title: '· 修复' };

async function nodeOf(taskId: string, key: string) {
  const { body: task } = await t.call(getTaskOp, { id: taskId });
  const node = task.nodes.find((n) => n.key === key);
  if (node === undefined) throw new Error(`No node ${key}`);
  return (await t.call(getNodeOp, { id: taskId, nodeId: node.id })).body;
}

describe('节点状态机（09 §3）', () => {
  it('running → done：有改动时由后端提交，无改动时不提交；下游 pending → ready', async () => {
    const { repo, project } = await addProject(t, { checkCommand: null });
    t.fake.enqueue(submit('Nothing to change'), locate);
    t.fake.enqueue(script().edit('fix.txt', 'x\n').callTool('submit_result', { summary: 'Fixed' }), fix);
    t.fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: 'ok' }), { agent: 'aw-reviewer' });
    const fixReady = nodeReaches(t, 'fix', 'ready');
    const review = taskReaches(t, 'review');
    const task = await createTask(t, { projectId: project.id, workflow: 'bugfix' });
    await fixReady;
    await review;

    expect(await nodeOf(task.id, 'locate')).toMatchObject({ status: 'done', commitSha: null });
    const fixed = await nodeOf(task.id, 'fix');
    expect(fixed).toMatchObject({ status: 'done', commitSha: expect.stringMatching(/^[0-9a-f]{40}$/) });
    expect(await repo.git('log', '-1', '--format=%an <%ae>|%s', fixed.commitSha ?? '')).toBe(
      'agent-workflow <agent-workflow@localhost>|T-1 修复',
    );
  });

  it('running → ready（尝试失败，带反馈）→ … → failed（预算耗尽）', async () => {
    await t.call(updateSettingsOp, { 'node.maxAttempts': 2 });
    const { project } = await addProject(t);
    t.fake.enqueue(script().error('APIError', 'Bad Gateway'), locate);
    const failed = nodeReaches(t, 'locate', 'failed');
    const task = await createTask(t, { projectId: project.id, workflow: 'bugfix' });
    await failed;

    const node = await nodeOf(task.id, 'locate');
    expect(node).toMatchObject({ attemptCount: 2, retryFeedback: expect.stringContaining('submit_result') });
    expect(node.attempts.map((a) => [a.status, a.error?.code])).toEqual([
      ['failed', ErrorCode.AttemptSessionError],
      ['failed', ErrorCode.AttemptNoResult],
    ]);
    // The second attempt was told why the first one failed.
    expect(t.fake.prompts.find((p) => p.text.includes('session error'))?.text).toContain('Your step: 定位根因');
  });

  it('verifying → ready（检查失败，输出作为反馈）→ verifying → done（M3-07）', async () => {
    const { project } = await addProject(t, { checkCommand: 'test -f fix.txt && echo checked' });
    t.fake.enqueue(submit('Located'), locate);
    t.fake.enqueue(submit('Fixed without the file'), fix);
    t.fake.enqueue(script().edit('fix.txt', 'x\n').callTool('submit_result', { summary: 'Fixed' }), fix);
    t.fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: 'ok' }), { agent: 'aw-reviewer' });
    const review = taskReaches(t, 'review');
    const task = await createTask(t, { projectId: project.id, workflow: 'bugfix' });
    await review;

    const fixed = await nodeOf(task.id, 'fix');
    expect(fixed).toMatchObject({
      status: 'done',
      attemptCount: 2,
      retryFeedback: expect.stringContaining('`test -f fix.txt && echo checked` exited with code 1'),
      checkResults: [
        { kind: 'command', passed: true, exitCode: 0, output: 'checked' },
        { kind: 'ai_review', passed: true, output: 'ok' },
      ],
    });
    const second = t.fake.prompts.filter((p) => p.text.includes('Your step: 修复'))[1];
    expect(second?.text).toContain('exited with code 1');
  });

  it('再次检查时不再带着上一份结果的检查结果；上次没通过的原因仍在 retryFeedback', async () => {
    const { project } = await addProject(t, { checkCommand: 'test -f fix.txt' });
    t.fake.enqueue(submit('Located'), locate);
    t.fake.enqueue(submit('Fixed without the file'), fix);
    t.fake.enqueue(script().edit('fix.txt', 'x\n').callTool('submit_result', { summary: 'Fixed' }), fix);
    // The first result's review passes; the second result's review keeps the step verifying.
    t.fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: 'ok' }), { agent: 'aw-reviewer' });
    t.fake.enqueue(script().hang(), { agent: 'aw-reviewer' });
    const second = waitForEvent(
      t.app.events,
      ServerEventType.NodeUpdated,
      (d) => d.node.key === 'fix' && d.node.status === 'verifying' && d.node.attemptCount === 2,
    );
    const task = await createTask(t, { projectId: project.id, workflow: 'bugfix' });
    await second;

    expect(await nodeOf(task.id, 'fix')).toMatchObject({
      status: 'verifying',
      checkResults: null,
      retryFeedback: expect.stringContaining('`test -f fix.txt` exited with code 1'),
    });
  });

  it('verifying → ready（AI 评审不通过，问题作为反馈）；不通过却没有 blocker/major 时 VALIDATION_FAILED', async () => {
    await t.call(updateSettingsOp, { 'node.maxAttempts': 1 });
    const { project } = await addProject(t, { checkCommand: null });
    t.fake.enqueue(submit('Located'), locate);
    t.fake.enqueue(submit('Fixed'), fix);
    t.fake.enqueue(
      script()
        .callTool('submit_review', {
          verdict: 'fail',
          summary: 'Hmm',
          issues: [{ severity: 'minor', description: 'nit' }],
        })
        .callTool('submit_review', {
          verdict: 'fail',
          summary: 'Symptom only',
          issues: [{ severity: 'major', path: 'src/a.ts', line: 3, description: 'Adds a fallback' }],
        }),
      { agent: 'aw-reviewer' },
    );
    const failed = nodeReaches(t, 'fix', 'failed');
    const task = await createTask(t, { projectId: project.id, workflow: 'bugfix' });
    await failed;
    await t.fake.settled();

    expect(t.fake.toolCalls.filter((c) => c.name === 'submit_review').map((c) => c.isError)).toEqual([true, false]);
    expect(t.fake.toolCalls.find((c) => c.name === 'submit_review')?.result).toMatchObject({
      code: ErrorCode.ValidationFailed,
      hint: expect.stringContaining('blocker or major'),
    });
    expect(await nodeOf(task.id, 'fix')).toMatchObject({
      retryFeedback: expect.stringContaining('- [major] src/a.ts:3 Adds a fallback'),
      checkResults: [{ kind: 'ai_review', passed: false, output: 'Symptom only' }],
    });
  });

  it('awaiting_acceptance：通过 → done；驳回 → ready 带意见（不消耗预算）', async () => {
    const { project } = await addProject(t, { checkCommand: null });
    t.fake.enqueue(submit('Located v1'), locate);
    t.fake.enqueue(submit('Located v2'), locate);
    const awaiting = inboxOpens(t, 'acceptance');
    const task = await createTask(t, {
      projectId: project.id,
      workflow: 'bugfix',
      checkpoints: { accept_each_node: true },
    });
    await awaiting;
    const node = await nodeOf(task.id, 'locate');
    expect(node).toMatchObject({ status: 'awaiting_acceptance', attemptCount: 1 });
    expect((await t.call(getTaskOp, { id: task.id })).body.displayGroup).toBe('needs_attention');

    const again = inboxOpens(t, 'acceptance');
    const rejected = await t.call(rejectNodeOp, { id: task.id, nodeId: node.id, feedback: 'Show the evidence' });
    expect(rejected.body).toMatchObject({
      status: 'ready',
      retryFeedback: expect.stringContaining('Show the evidence'),
    });
    await again;
    expect(await nodeOf(task.id, 'locate')).toMatchObject({ status: 'awaiting_acceptance', attemptCount: 2 });

    const fixRunning = nodeReaches(t, 'fix', 'running');
    expect((await t.call(acceptNodeOp, { id: task.id, nodeId: node.id })).body.status).toBe('done');
    await fixRunning;
  });

  it('通过节点时任务与节点不匹配：NODE_NOT_FOUND，且不改动该节点', async () => {
    const { project } = await addProject(t, { checkCommand: null });
    t.fake.enqueue(script().edit('a.txt', 'a\n').callTool('submit_result', { summary: 'A' }), locate);
    t.fake.enqueue(submit('B'), locate);
    let waiting = 0;
    const bothAwait = new Promise<void>((resolve) => {
      t.app.events.subscribe((e) => {
        if (e.type === 'node.updated' && e.data.node.status === 'awaiting_acceptance' && ++waiting === 2) resolve();
      });
    });
    const a = await createTask(t, {
      projectId: project.id,
      workflow: 'bugfix',
      checkpoints: { accept_each_node: true },
    });
    const b = await createTask(t, {
      projectId: project.id,
      workflow: 'bugfix',
      checkpoints: { accept_each_node: true },
    });
    await bothAwait;
    const nodeOfA = await nodeOf(a.id, 'locate');

    const res = await t.call(acceptNodeOp, { id: b.id, nodeId: nodeOfA.id });
    expect(res.body).toMatchObject({ error: { code: ErrorCode.NodeNotFound } });
    expect(await nodeOf(a.id, 'locate')).toMatchObject({ status: 'awaiting_acceptance', commitSha: null });
  });

  it('running → ready（运行时消失，不消耗预算）；waiting_input → ready（用户中止，按 attempt_failed）', async () => {
    const { project } = await addProject(t);
    t.fake.enqueue(script().hang(), locate);
    const running = nodeReaches(t, 'locate', 'running');
    const task = await createTask(t, { projectId: project.id, workflow: 'bugfix' });
    await running;

    const interrupted = nodeReaches(t, 'locate', 'ready');
    t.fake.crash();
    await interrupted;
    expect(await nodeOf(task.id, 'locate')).toMatchObject({ attemptCount: 0 });

    t.fake.reconnect();
    t.fake.enqueue(script().requestPermission('bash', ['rm -rf dist']), locate);
    const waiting = nodeReaches(t, 'locate', 'waiting_input');
    // Any settings change wakes the scheduler, as the runtime's ready event would.
    await t.call(updateSettingsOp, { 'scheduler.maxConcurrentAttempts': 4 });
    await waiting;
    const node = await nodeOf(task.id, 'locate');
    const attempt = node.attempts.at(-1);
    const failed = nodeReaches(t, 'locate', 'ready');
    await t.call(abortAttemptOp, { id: attempt?.id ?? '' });
    expect(await failed).toMatchObject({ node: { attemptCount: 1 } });
    // The permission request died with the attempt.
    expect((await t.call(getTaskOp, { id: task.id })).body.openInbox).toEqual([]);
  });
});
