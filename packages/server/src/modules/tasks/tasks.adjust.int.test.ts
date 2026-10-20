import {
  acceptNodeOp,
  confirmPlanOp,
  ErrorCode,
  getNodeOp,
  getTaskOp,
  listPlansOp,
  type PlanGraph,
  pauseTaskOp,
  resolveInboxOp,
  resumeTaskOp,
  retryTaskOp,
  saveDraftPlanOp,
  skipNodeOp,
  type TaskDetailDTO,
  updateSettingsOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { addProject, createTask, inboxOpens, nodeReaches, taskReaches } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const submit = (summary: string) => script().callTool('submit_result', { summary });

/** The confirmed (or reviewed) plan graph of the task, with `edit` applied to a copy. */
function edited(task: TaskDetailDTO, edit: (graph: PlanGraph) => void): PlanGraph {
  if (task.plan === null) throw new Error(`Task ${task.key} has no plan`);
  const graph: PlanGraph = structuredClone(task.plan.graph);
  edit(graph);
  return graph;
}

const nodeByKey = (task: TaskDetailDTO, key: string) => {
  const node = task.nodes.find((n) => n.key === key);
  if (node === undefined) throw new Error(`No node ${key}`);
  return node;
};

describe('暂停调整（M5-02）', () => {
  it('暂停后只能改未开始的步骤：改已开始的步骤 409；确认新版本后重新物化，继续后按新计划执行', async () => {
    const { project } = await addProject(t, { checkCommand: null });
    t.fake.enqueue(submit('Located'), { title: '· 定位根因' });
    const awaiting = nodeReaches(t, 'locate', 'awaiting_acceptance');
    const task = await createTask(t, {
      projectId: project.id,
      workflow: 'bugfix',
      checkpoints: { accept_each_node: true },
    });
    await awaiting;

    const pausing = (await t.call(pauseTaskOp, { id: task.id })).body;
    expect(pausing.status).toBe('paused');
    const fixReady = nodeReaches(t, 'fix', 'ready');
    await t.call(acceptNodeOp, { id: task.id, nodeId: nodeByKey(pausing, 'locate').id });
    await fixReady;
    const paused = (await t.call(getTaskOp, { id: task.id })).body;

    const lockedEdit = edited(paused, (g) => {
      const locate = g.nodes.find((n) => n.key === 'locate');
      if (locate !== undefined) locate.instructions = 'Look elsewhere';
    });
    expect((await t.call(saveDraftPlanOp, { id: task.id, baseVersion: 1, graph: lockedEdit })).body).toMatchObject({
      error: { code: ErrorCode.NodeNotEditable, details: { nodes: ['locate'] } },
    });

    const cyclic = edited(paused, (g) => {
      for (const n of g.nodes) if (n.key === 'fix') n.dependsOn = ['locate', 'fix'];
    });
    expect((await t.call(saveDraftPlanOp, { id: task.id, baseVersion: 1, graph: cyclic })).body).toMatchObject({
      error: { code: ErrorCode.PlanInvalid },
    });

    // A new step before the fix: the ready fix waits for it.
    const withPrep = edited(paused, (g) => {
      g.nodes.splice(1, 0, {
        key: 'prep',
        title: 'Prepare fixtures',
        roleKey: 'developer',
        instructions: 'Add the fixtures the fix needs',
        dependsOn: ['locate'],
      });
      for (const n of g.nodes) if (n.key === 'fix') n.dependsOn = ['prep'];
    });
    const saved = await t.call(saveDraftPlanOp, { id: task.id, baseVersion: 1, graph: withPrep });
    expect(saved.body).toMatchObject({ version: 2, status: 'draft', source: 'user' });
    expect((await t.call(saveDraftPlanOp, { id: task.id, baseVersion: 1, graph: withPrep })).body).toMatchObject({
      error: { code: ErrorCode.PlanVersionConflict },
    });
    const withDraft = (await t.call(getTaskOp, { id: task.id })).body;
    expect([withDraft.plan?.version, withDraft.draftPlan?.version]).toEqual([1, 2]);

    // The ready fix waits again; the new step is released by the scheduler like any other.
    const prepReady = nodeReaches(t, 'prep', 'ready');
    const confirmed = (await t.call(confirmPlanOp, { id: task.id, version: 2 })).body;
    expect(confirmed).toMatchObject({ status: 'paused', plan: { version: 2 }, draftPlan: null });
    expect(confirmed.nodes.map((n) => [n.key, n.status])).toEqual([
      ['locate', 'done'],
      ['prep', 'pending'],
      ['fix', 'pending'],
    ]);
    await prepReady;
    // Nothing was dispatched while paused.
    expect(t.fake.sessions.map((s) => s.title)).toEqual([`${task.key} · 定位根因`]);

    t.fake.enqueue(submit('Prepared'), { title: '· Prepare fixtures' });
    const prepRuns = nodeReaches(t, 'prep', 'awaiting_acceptance');
    expect((await t.call(resumeTaskOp, { id: task.id })).body.status).toBe('running');
    await prepRuns;
    const prep = (await t.call(getNodeOp, { id: task.id, nodeId: nodeByKey(confirmed, 'prep').id })).body;
    expect(prep).toMatchObject({ instructions: 'Add the fixtures the fix needs', result: { summary: 'Prepared' } });
  });

  it('继续执行时丢弃未确认的调整', async () => {
    const { project } = await addProject(t, { checkCommand: null });
    t.fake.enqueue(script().hang(), { title: '· 定位根因' });
    const running = nodeReaches(t, 'locate', 'running');
    const task = await createTask(t, { projectId: project.id, workflow: 'bugfix' });
    await running;
    const paused = (await t.call(pauseTaskOp, { id: task.id })).body;
    const graph = edited(paused, (g) => {
      for (const n of g.nodes) if (n.key === 'fix') n.title = 'Fix it properly';
    });
    await t.call(saveDraftPlanOp, { id: task.id, baseVersion: 1, graph });

    const resumed = (await t.call(resumeTaskOp, { id: task.id })).body;
    expect(resumed).toMatchObject({ status: 'running', draftPlan: null, plan: { version: 1 } });
    expect((await t.call(listPlansOp, { id: task.id })).body.items.map((p) => [p.version, p.status])).toEqual([
      [2, 'superseded'],
      [1, 'confirmed'],
    ]);
  });

  it('待确认计划可任意编辑，在需要你处理中确认的是编辑后的版本', async () => {
    const { project } = await addProject(t, { checkCommand: null });
    const review = inboxOpens(t, 'plan');
    const task = await createTask(t, {
      projectId: project.id,
      workflow: 'bugfix',
      checkpoints: { confirm_plan: true },
    });
    const item = await review;
    const reviewing = (await t.call(getTaskOp, { id: task.id })).body;
    const graph = edited(reviewing, (g) => {
      g.nodes = g.nodes.filter((n) => n.key !== 'locate');
      for (const n of g.nodes) n.dependsOn = [];
    });
    expect((await t.call(saveDraftPlanOp, { id: task.id, baseVersion: 1, graph })).body.version).toBe(2);

    t.fake.enqueue(script().hang(), { title: '· 修复' });
    const fixRuns = nodeReaches(t, 'fix', 'running');
    await t.call(resolveInboxOp, { id: item.item.id, response: { confirmed: true } });
    await fixRuns;
    const running = (await t.call(getTaskOp, { id: task.id })).body;
    expect(running).toMatchObject({ status: 'running', plan: { version: 2, status: 'confirmed' } });
    expect(running.nodes.map((n) => n.key)).toEqual(['fix']);
  });
});

describe('跳过步骤（M5-03）', () => {
  it('失败的步骤被跳过后视为完成：重试任务后下游继续，任务进入待合并', async () => {
    await t.call(updateSettingsOp, { 'node.maxAttempts': 1 });
    const { project } = await addProject(t, { checkCommand: null });
    t.fake.enqueue(script().error('APIError', 'Bad Gateway'), { title: '· 定位根因' });
    const failed = taskReaches(t, 'failed');
    const task = await createTask(t, { projectId: project.id, workflow: 'bugfix' });
    await failed;

    const locate = nodeByKey((await t.call(getTaskOp, { id: task.id })).body, 'locate');
    const skipped = (await t.call(skipNodeOp, { id: task.id, nodeId: locate.id })).body;
    expect(skipped).toMatchObject({ status: 'skipped', finishedAt: expect.any(Number) });
    expect((await t.call(skipNodeOp, { id: task.id, nodeId: locate.id })).body).toMatchObject({
      error: { code: ErrorCode.StateTransitionInvalid },
    });

    t.fake.enqueue(submit('Fixed'), { title: '· 修复' });
    t.fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: 'ok' }), { agent: 'aw-reviewer' });
    const review = taskReaches(t, 'review');
    await t.call(retryTaskOp, { id: task.id });
    await review;
  });
});
