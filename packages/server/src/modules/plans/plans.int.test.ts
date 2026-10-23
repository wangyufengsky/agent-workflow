import { ErrorCode, getNodeOp, getPlanOp, getTaskOp, listPlansOp, replanOp, updateProjectOp } from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { addProject, createTask, finalVerify, planArgs, taskReaches } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const planner = { agent: 'aw-planner' };

describe('计划（M3-04）', () => {
  it('非法计划返回 PLAN_INVALID 与逐项 hint，模型修正后通过；必经步骤保留流程定义的标题、角色与验收', async () => {
    const { project } = await addProject(t, { checkCommand: 'npm test' });
    const invalid = planArgs([
      { key: 'a', depends_on: ['b'] },
      { key: 'b', depends_on: ['a'], role: 'chef' },
    ]);
    const valid = planArgs([
      { key: 'a', acceptance: { command: '$PROJECT_CHECK -- a.test.ts', manual: true } },
      { key: 'b', depends_on: ['a'], acceptance: { ai_review: true } },
      { ...finalVerify(['b']), role: 'tester', title: 'Verify everything', acceptance: {} },
    ]);
    t.fake.enqueue(script().callTool('submit_plan', invalid).callTool('submit_plan', valid).hang(), planner);
    const confirmed = await new Promise<string>((resolve) => {
      const off = t.app.events.subscribe((e) => {
        if (e.type === 'plan.updated' && e.data.plan.status === 'confirmed') {
          off();
          resolve(e.data.taskId);
        }
      });
      void createTask(t, { projectId: project.id, workflow: 'feature' });
    });
    await t.fake.settled();

    const [rejected, accepted] = t.fake.toolCalls;
    expect(rejected).toMatchObject({
      isError: true,
      result: { code: ErrorCode.PlanInvalid, hint: expect.stringContaining('details.problems') },
    });
    if (rejected === undefined) throw new Error('submit_plan was not called');
    const { problems } = (rejected.result as { details: { problems: Array<{ code: string; hint: string }> } }).details;
    expect(problems.map((p) => p.code).sort()).toEqual(['CYCLE', 'MISSING_REQUIRED_STEP', 'UNKNOWN_ROLE']);
    expect(problems.every((p) => p.hint.length > 0)).toBe(true);
    expect(accepted).toMatchObject({ isError: false, result: { version: 1, accepted: true } });

    const { body: task } = await t.call(getTaskOp, { id: confirmed });
    const byKey = Object.fromEntries(task.nodes.map((n) => [n.key, n]));
    expect(byKey.final_verify).toMatchObject({ title: '整体验证', roleKey: 'developer' });
    const acceptance = async (key: string) =>
      (await t.call(getNodeOp, { id: confirmed, nodeId: byKey[key]?.id ?? '' })).body.acceptance;
    // $PROJECT_CHECK became the project's check command; the workflow default applies where none was given.
    expect(await acceptance('a')).toEqual({
      checks: [{ kind: 'command', command: 'npm test -- a.test.ts' }],
      manual: true,
    });
    expect(await acceptance('b')).toEqual({ checks: [{ kind: 'ai_review' }], manual: false });
    expect(await acceptance('final_verify')).toEqual({
      checks: [
        { kind: 'command', command: 'npm test' },
        { kind: 'ai_review', focus: '需求完整性与正确性' },
      ],
      manual: false,
    });
  });

  it('项目没有检查命令时 $PROJECT_CHECK 检查被移除', async () => {
    const { project } = await addProject(t, { checkCommand: null });
    t.fake.enqueue(script().callTool('submit_plan', planArgs([{ key: 'a' }, finalVerify(['a'])])), planner);
    t.fake.enqueue(script().hang(), { title: '· a' });
    const running = taskReaches(t, 'running');
    const task = await createTask(t, { projectId: project.id, workflow: 'feature' });
    await running;
    const { body } = await t.call(getTaskOp, { id: task.id });
    const verify = body.nodes.find((n) => n.key === 'final_verify');
    const { body: node } = await t.call(getNodeOp, { id: task.id, nodeId: verify?.id ?? '' });
    expect(node.acceptance).toEqual({ checks: [{ kind: 'ai_review', focus: '需求完整性与正确性' }], manual: false });
  });

  it('项目有页面预览：规划能看到关键页面，步骤要求的页面与必经步骤的关键页面在确认时冻结（29 §7.1）', async () => {
    const { project } = await addProject(t, { checkCommand: 'npm test' });
    const preview = { command: 'npm run dev', setupCommand: null, readyPath: '/', extraOrigins: [] };
    await t.call(updateProjectOp, { id: project.id, preview: { ...preview, pages: ['/', '/orders'] } });
    const plan = planArgs([
      { key: 'form', acceptance: { command: '$PROJECT_CHECK', pages: ['/orders/new'] } },
      finalVerify(['form']),
    ]);
    t.fake.enqueue(script().callTool('get_task_context', {}).callTool('submit_plan', plan), planner);
    t.fake.enqueue(script().hang(), { title: '· form' });
    const running = taskReaches(t, 'running');
    const task = await createTask(t, { projectId: project.id, workflow: 'feature' });
    await running;
    expect(t.fake.toolCalls[0]?.result).toMatchObject({ project: { previewPages: ['/', '/orders'] } });
    // Later changes to the project's pages do not reach a confirmed plan.
    await t.call(updateProjectOp, { id: project.id, preview: { ...preview, pages: ['/changed'] } });

    const { body } = await t.call(getTaskOp, { id: task.id });
    const acceptance = async (key: string) =>
      (await t.call(getNodeOp, { id: task.id, nodeId: body.nodes.find((n) => n.key === key)?.id ?? '' })).body
        .acceptance.checks;
    const viewports = ['desktop', 'mobile'];
    expect(await acceptance('form')).toEqual([
      { kind: 'command', command: 'npm test' },
      { kind: 'browser', pages: ['/orders/new'], viewports },
    ]);
    expect(await acceptance('final_verify')).toEqual([
      { kind: 'command', command: 'npm test' },
      { kind: 'browser', pages: ['/', '/orders'], viewports },
      { kind: 'ai_review', focus: '需求完整性与正确性' },
    ]);
  });

  it('确认计划检查点：按意见重新规划在同一会话中进行，新版本记录反馈，旧草稿被取代', async () => {
    const { project } = await addProject(t, { checkCommand: null });
    t.fake.enqueue(
      script().callTool('submit_plan', planArgs([{ key: 'a' }, finalVerify(['a'])], { assumptions: ['One step'] })),
      planner,
    );
    const review1 = taskReaches(t, 'plan_review');
    const task = await createTask(t, {
      projectId: project.id,
      workflow: 'feature',
      checkpoints: { confirm_plan: true },
    });
    await review1;
    expect((await t.call(getTaskOp, { id: task.id })).body.plan).toMatchObject({
      version: 1,
      status: 'draft',
      assumptions: ['One step'],
    });

    t.fake.enqueue(
      script().callTool('submit_plan', planArgs([{ key: 'a' }, { key: 'b' }, finalVerify(['a', 'b'])])),
      planner,
    );
    const review2 = taskReaches(t, 'plan_review');
    const replanned = await t.call(replanOp, { id: task.id, feedback: 'Split it in two' });
    expect(replanned.body.status).toBe('planning');
    await review2;

    const plannerSessions = t.fake.sessions.filter((s) => s.agent === 'aw-planner');
    expect(plannerSessions).toHaveLength(1);
    expect(t.fake.prompts.at(-1)).toMatchObject({
      sessionId: plannerSessions[0]?.id,
      text: expect.stringContaining('Split it in two'),
    });
    expect(
      (await t.call(listPlansOp, { id: task.id })).body.items.map((p) => [p.version, p.status, p.feedback]),
    ).toEqual([
      [2, 'draft', 'Split it in two'],
      [1, 'superseded', null],
    ]);
    expect((await t.call(getPlanOp, { id: task.id, version: 2 })).body.graph.nodes.map((n) => n.key)).toEqual([
      'a',
      'b',
      'final_verify',
    ]);
  });

  it('固定流程的计划不能重新规划', async () => {
    const { project } = await addProject(t);
    const review = taskReaches(t, 'plan_review');
    const task = await createTask(t, {
      projectId: project.id,
      workflow: 'bugfix',
      checkpoints: { confirm_plan: true },
    });
    await review;
    expect((await t.call(replanOp, { id: task.id, feedback: 'x' })).body).toMatchObject({
      error: { code: ErrorCode.ValidationFailed },
    });
  });
});
