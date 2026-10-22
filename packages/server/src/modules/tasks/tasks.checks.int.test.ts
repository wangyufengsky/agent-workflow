import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ErrorCode,
  getNodeOp,
  getProjectOp,
  getTaskOp,
  listInboxOp,
  retryTaskOp,
  skipCheckOp,
  type TaskDetailDTO,
  updateCheckCommandOp,
  updateSettingsOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { addProject, createTask, taskReaches } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const passReview = () => script().callTool('submit_review', { verdict: 'pass', summary: 'Looks right' });

/** A bug-fix task whose `fix` step (check: the project check + AI review) submits its result once. */
async function failsOnCheck(checkCommand: string): Promise<TaskDetailDTO> {
  const { project } = await addProject(t, { checkCommand });
  t.fake.enqueue(script().callTool('submit_result', { summary: 'Root cause: off by one' }), { title: '定位根因' });
  t.fake.enqueue(script().edit('fix.txt', 'fixed\n').callTool('submit_result', { summary: 'Fixed' }), {
    title: '· 修复',
  });
  const failed = taskReaches(t, 'failed');
  const task = await createTask(t, { projectId: project.id, workflow: 'bugfix' });
  await failed;
  return (await t.call(getTaskOp, { id: task.id })).body;
}

const fixNode = (task: TaskDetailDTO) => {
  const node = task.nodes.find((n) => n.key === 'fix');
  if (node === undefined) throw new Error('No fix step');
  return node;
};
const fixSessions = () => t.fake.sessions.filter((s) => s.agent === 'aw-executor' && s.title.endsWith('· 修复'));

describe('检查命令因环境无法运行（D115）', () => {
  it('不发回 AI、不消耗次数，任务停下说明原因；环境修好后重试只重新检查，不重跑 AI', async () => {
    const task = await failsOnCheck('./check.sh');
    expect(task).toMatchObject({
      failedPhase: 'running',
      failure: {
        code: ErrorCode.CheckCommandUnrunnable,
        details: { nodeKey: 'fix', command: './check.sh', program: './check.sh', reason: 'not_found' },
      },
    });
    expect(fixNode(task)).toMatchObject({ status: 'failed', attemptCount: 0 });
    expect(fixSessions()).toHaveLength(1);
    const { body: node } = await t.call(getNodeOp, { id: task.id, nodeId: fixNode(task).id });
    expect(node.retryFeedback).toBeNull();
    const { body: inbox } = await t.call(listInboxOp, { taskId: task.id, status: 'open' });
    expect(inbox.items.map((i) => i.kind)).toEqual(['failure']);

    const check = join(task.git.worktreePath ?? '', 'check.sh');
    await writeFile(check, '#!/bin/sh\nexit 0\n');
    await chmod(check, 0o755);
    t.fake.enqueue(passReview(), { agent: 'aw-reviewer' });
    const review = taskReaches(t, 'review');
    await t.call(retryTaskOp, { id: task.id });
    await review;
    expect(fixSessions()).toHaveLength(1);
    const { body: done } = await t.call(getTaskOp, { id: task.id });
    expect(done.result?.checks.filter((c) => c.nodeKey === 'fix').map((c) => [c.kind, c.passed])).toEqual([
      ['command', true],
      ['ai_review', true],
    ]);
  });

  it('修改检查命令：改写这个任务已冻结的检查并可同时设为项目的检查命令，用已交的结果重新检查', async () => {
    const task = await failsOnCheck('aw-no-such-tool -q test');
    t.fake.enqueue(passReview(), { agent: 'aw-reviewer' });
    const review = taskReaches(t, 'review');
    const updated = await t.call(updateCheckCommandOp, {
      id: task.id,
      command: 'test -f fix.txt',
      updateProject: true,
    });
    expect(updated.body.status).toBe('running');
    await review;

    expect(fixSessions()).toHaveLength(1);
    const { body: node } = await t.call(getNodeOp, { id: task.id, nodeId: fixNode(task).id });
    expect(node.acceptance.checks[0]).toEqual({ kind: 'command', command: 'test -f fix.txt' });
    expect((await t.call(getProjectOp, { id: task.project.id })).body.checkCommand).toBe('test -f fix.txt');
  });

  it('跳过这项检查：结果卡标为已跳过，其余检查（AI 评审）照常', async () => {
    const task = await failsOnCheck('aw-no-such-tool -q test');
    t.fake.enqueue(passReview(), { agent: 'aw-reviewer' });
    const review = taskReaches(t, 'review');
    await t.call(skipCheckOp, { id: task.id });
    await review;

    const { body: done } = await t.call(getTaskOp, { id: task.id });
    expect(done.result?.checks.filter((c) => c.nodeKey === 'fix')).toEqual([
      {
        nodeKey: 'fix',
        nodeTitle: '修复',
        kind: 'command',
        passed: true,
        command: 'aw-no-such-tool -q test',
        skipped: true,
      },
      { nodeKey: 'fix', nodeTitle: '修复', kind: 'ai_review', passed: true, command: null, skipped: false },
    ]);
    expect(fixSessions()).toHaveLength(1);
  });

  it('不是检查命令导致的失败不能修改或跳过检查（409 STATE_TRANSITION_INVALID）', async () => {
    await t.call(updateSettingsOp, { 'node.maxAttempts': 1 });
    const { project } = await addProject(t, { checkCommand: 'true' });
    const failed = taskReaches(t, 'failed');
    const task = await createTask(t, { projectId: project.id, workflow: 'bugfix' });
    await failed;

    const skip = await t.call(skipCheckOp, { id: task.id });
    expect(skip).toMatchObject({ status: 409, body: { error: { code: ErrorCode.StateTransitionInvalid } } });
    const update = await t.call(updateCheckCommandOp, { id: task.id, command: 'pnpm test', updateProject: false });
    expect(update).toMatchObject({ status: 409, body: { error: { code: ErrorCode.StateTransitionInvalid } } });
  });
});
