import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cancelTaskOp,
  confirmPlanOp,
  deleteProjectOp,
  ErrorCode,
  getTaskOp,
  listInboxOp,
  listProjectsOp,
  retryTaskOp,
  startTaskOp,
  updateSettingsOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { addProject, createTask, finalVerify, inboxOpens, planArgs, taskReaches } from '../../../test/helpers/tasks.ts';
import { branchName } from '../worktrees/index.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const submit = (summary: string) => script().callTool('submit_result', { summary });
const passReview = () => script().callTool('submit_review', { verdict: 'pass', summary: 'Looks right' });

/** Scripts for both steps of the bugfix workflow and the review of `fix`. */
function scriptBugfix(): void {
  t.fake.enqueue(submit('Root cause: off by one'), { title: '定位根因' });
  t.fake.enqueue(script().edit('fix.txt', 'fixed\n').callTool('submit_result', { summary: 'Fixed' }), {
    title: '· 修复',
  });
  t.fake.enqueue(passReview(), { agent: 'aw-reviewer' });
}

const statusOf = async (id: string) => (await t.call(getTaskOp, { id })).body.status;

describe('任务状态机（09 §2）', () => {
  it('draft → preparing → running（固定流程、无检查点）→ review；检查点按 请求 > 流程 > 设置 解析', async () => {
    await t.call(updateSettingsOp, { 'ai.askOnUncertainty': true });
    const { project } = await addProject(t, { checkCommand: null });
    const draft = await createTask(t, {
      projectId: project.id,
      workflow: 'bugfix',
      start: false,
      checkpoints: { accept_each_node: false },
    });
    expect(draft).toMatchObject({
      status: 'draft',
      checkpoints: { confirm_plan: false, accept_each_node: false, ask_on_uncertainty: true },
    });

    scriptBugfix();
    const running = taskReaches(t, 'running');
    const review = taskReaches(t, 'review');
    expect((await t.call(startTaskOp, { id: draft.id })).body.status).toBe('preparing');
    await running;
    await review;
    const { body: task } = await t.call(getTaskOp, { id: draft.id });
    expect(task.plan).toMatchObject({ version: 1, status: 'confirmed', source: 'template' });
    expect(task.nodes.map((n) => [n.key, n.status])).toEqual([
      ['locate', 'done'],
      ['fix', 'done'],
    ]);
    // ask_on_uncertainty reached the sessions as the rule to ask.
    expect(t.fake.prompts[0]?.text).toContain('The user wants to be asked');
  });

  it('draft → cancelled：草稿取消后不再启动', async () => {
    const { project } = await addProject(t);
    const draft = await createTask(t, { projectId: project.id, workflow: 'bugfix', start: false });
    expect((await t.call(cancelTaskOp, { id: draft.id })).body.status).toBe('cancelled');
    expect((await t.call(startTaskOp, { id: draft.id })).body).toMatchObject({
      error: { code: ErrorCode.StateTransitionInvalid },
    });
  });

  it('preparing → failed（建工作区失败）→ 用户重试 → preparing → plan_review（固定流程 + 确认计划）→ running', async () => {
    const { repo, project } = await addProject(t);
    const blocker = branchName('T-1', 'Add a greeting module');
    await repo.git('branch', blocker);

    const failed = taskReaches(t, 'failed');
    const task = await createTask(t, {
      projectId: project.id,
      workflow: 'bugfix',
      checkpoints: { confirm_plan: true },
    });
    const failedTask = await failed;
    expect(failedTask.displayGroup).toBe('failed');
    const { body: detail } = await t.call(getTaskOp, { id: task.id });
    expect(detail).toMatchObject({ failedPhase: 'preparing', failure: { code: ErrorCode.WorktreeCreateFailed } });
    expect(detail.openInbox.map((i) => i.kind)).toEqual(['failure']);

    await repo.git('branch', '-D', blocker);
    const planReview = taskReaches(t, 'plan_review');
    expect((await t.call(retryTaskOp, { id: task.id })).body.status).toBe('preparing');
    await planReview;
    const { body: reviewing } = await t.call(getTaskOp, { id: task.id });
    expect(reviewing).toMatchObject({ failure: null, plan: { version: 1, status: 'draft', source: 'template' } });
    expect(reviewing.openInbox.map((i) => i.kind)).toEqual(['plan']);
    // The failure item was resolved by the retry.
    expect((await t.call(listInboxOp, { taskId: task.id, status: 'resolved' })).body.items).toMatchObject([
      { kind: 'failure', response: { action: 'retry' } },
    ]);

    expect((await t.call(confirmPlanOp, { id: task.id, version: 2 })).body).toMatchObject({
      error: { code: ErrorCode.PlanVersionConflict },
    });
    scriptBugfix();
    const review = taskReaches(t, 'review');
    const confirmed = await t.call(confirmPlanOp, { id: task.id, version: 1 });
    expect(confirmed.body).toMatchObject({ status: 'running', plan: { status: 'confirmed' }, openInbox: [] });
    await review;
  });

  it('planning → failed（规划会话未提交）→ 重试 → planning → running', async () => {
    const { project } = await addProject(t, { checkCommand: null });
    const failed = taskReaches(t, 'failed');
    const task = await createTask(t, { projectId: project.id, workflow: 'feature' });
    await failed;
    expect((await t.call(getTaskOp, { id: task.id })).body).toMatchObject({
      failedPhase: 'planning',
      failure: { code: ErrorCode.AttemptNoResult },
    });

    t.fake.enqueue(script().callTool('submit_plan', planArgs([{ key: 'impl' }, finalVerify(['impl'])])), {
      agent: 'aw-planner',
    });
    const running = taskReaches(t, 'running');
    await t.call(retryTaskOp, { id: task.id });
    await running;
    // A new planning session, not the failed one.
    expect(t.fake.sessions.filter((s) => s.agent === 'aw-planner')).toHaveLength(2);
  });

  it('running → failed（节点预算耗尽）→ 重试重置预算 → running → review', async () => {
    await t.call(updateSettingsOp, { 'node.maxAttempts': 1 });
    const { project } = await addProject(t, { checkCommand: null });
    const failed = taskReaches(t, 'failed');
    const task = await createTask(t, { projectId: project.id, workflow: 'bugfix' });
    await failed;
    const { body: detail } = await t.call(getTaskOp, { id: task.id });
    expect(detail).toMatchObject({
      failedPhase: 'running',
      failure: { code: ErrorCode.NodeAttemptsExhausted, details: { nodeKey: 'locate' } },
    });
    expect(detail.nodes.map((n) => [n.key, n.status, n.attemptCount])).toEqual([
      ['locate', 'failed', 1],
      ['fix', 'pending', 0],
    ]);

    scriptBugfix();
    const review = taskReaches(t, 'review');
    const retried = await t.call(retryTaskOp, { id: task.id });
    expect(retried.body.status).toBe('running');
    await review;
  });

  it('running → cancelled：中止会话、取消节点、关闭条目、删除工作区与分支', async () => {
    const { repo, project } = await addProject(t);
    t.fake.enqueue(script().ask({ question: 'Which file?', blocking: false, default_assumption: 'a.ts' }).hang(), {
      title: '定位根因',
    });
    await t.call(updateSettingsOp, { 'ai.askOnUncertainty': true });
    const asked = inboxOpens(t, 'question');
    const task = await createTask(t, { projectId: project.id, workflow: 'bugfix' });
    await asked;

    const { body: cancelled } = await t.call(cancelTaskOp, { id: task.id });
    expect(cancelled).toMatchObject({ status: 'cancelled', activeAttempts: [], openInbox: [] });
    expect(cancelled.nodes.map((n) => n.status)).toEqual(['cancelled', 'cancelled']);
    expect(t.fake.aborts).toHaveLength(1);
    await t.fake.settled();
    expect((await t.call(listInboxOp, { taskId: task.id })).body.items).toMatchObject([
      { kind: 'question', status: 'dismissed' },
    ]);
    expect(cancelled.git).toMatchObject({ worktreeStatus: 'removed' });
    expect(existsSync(cancelled.git.worktreePath ?? '')).toBe(false);
    expect(await repo.git('branch', '--list', 'aw/*')).toBe('');
  });

  it('plan_review、review 与 failed 都可以取消', async () => {
    const { project } = await addProject(t, { checkCommand: null });
    const cases = [
      { workflow: 'bugfix', checkpoints: { confirm_plan: true }, wait: 'plan_review' as const, scripted: false },
      { workflow: 'bugfix', checkpoints: {}, wait: 'review' as const, scripted: true },
      { workflow: 'feature', checkpoints: {}, wait: 'failed' as const, scripted: false },
    ];
    for (const c of cases) {
      if (c.scripted) scriptBugfix();
      const reached = taskReaches(t, c.wait);
      const task = await createTask(t, { projectId: project.id, workflow: c.workflow, checkpoints: c.checkpoints });
      await reached;
      expect((await t.call(cancelTaskOp, { id: task.id, keepBranch: true })).body).toMatchObject({
        status: 'cancelled',
        openInbox: [],
      });
    }
  });

  it('preparing → cancelled：建工作区期间取消', async () => {
    const { repo, project } = await addProject(t);
    // A post-checkout hook holds `git worktree add` until the test releases it through a FIFO.
    const fifo = join(await mkdtemp(join(tmpdir(), 'aw-fifo-')), 'release');
    execFileSync('mkfifo', [fifo]);
    const hook = join(repo.path, '.git', 'hooks', 'post-checkout');
    await writeFile(hook, `#!/bin/sh\ncat "${fifo}" > /dev/null\n`);
    await chmod(hook, 0o755);

    const task = await createTask(t, { projectId: project.id, workflow: 'bugfix' });
    expect(task.status).toBe('preparing');
    expect((await t.call(cancelTaskOp, { id: task.id })).body.status).toBe('cancelled');
    await writeFile(fifo, 'go\n');
    expect(await statusOf(task.id)).toBe('cancelled');
  });
});

describe('删除项目', () => {
  it('有未结束的任务时 409 PROJECT_HAS_ACTIVE_TASKS；任务结束后连同任务一起删除', async () => {
    const { project } = await addProject(t);
    const task = await createTask(t, { projectId: project.id, workflow: 'bugfix', start: false });
    expect((await t.call(deleteProjectOp, { id: project.id })).body).toMatchObject({
      error: { code: ErrorCode.ProjectHasActiveTasks, details: { tasks: ['T-1'] } },
    });
    await t.call(cancelTaskOp, { id: task.id });
    expect((await t.call(deleteProjectOp, { id: project.id })).status).toBe(204);
    expect((await t.call(listProjectsOp, {})).body.items).toEqual([]);
    expect((await t.call(getTaskOp, { id: task.id })).body).toMatchObject({ error: { code: ErrorCode.TaskNotFound } });
  });
});
