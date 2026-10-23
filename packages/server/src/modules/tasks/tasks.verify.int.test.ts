import {
  createTaskOp,
  ErrorCode,
  getRequirementsOp,
  getTaskOp,
  type RequirementItemInput,
  requestChangesOp,
  ServerEventType,
  startTaskOp,
  type TaskRequirementsDTO,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, finalVerify, planArgs, workflowId } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const CHECKLIST: RequirementItemInput[] = [
  { title: '按订单号搜索', expected: '只显示匹配订单' },
  { title: '单元测试通过', expected: '退出码 0', verification: { kind: 'command', command: 'false' } },
  { title: '能构建', expected: '退出码 0', verification: { kind: 'command', command: 'true' } },
  { title: '窄窗口可用', expected: '1024 宽下按钮可点', verification: { kind: 'manual' } },
];

const reaches = (taskId: string, status: string) =>
  waitForEvent(t.app.events, ServerEventType.TaskUpdated, (d) => d.id === taskId && d.status === status);

const statuses = (view: TaskRequirementsDTO) => view.items.map((i) => [i.title, i.status, i.latest?.source ?? null]);

describe('核验验收清单步骤（31 §2.2，Q-02）', () => {
  it('固定流程最后多一个核验步骤：AI 项按其结论，命令项逐条运行（失败不重试、不挡步骤），人工项待确认；只有核验步骤能交结论', async () => {
    const { project } = await addProject(t);
    const { body: task } = await t.call(createTaskOp, {
      projectId: project.id,
      workflowId: await workflowId(t, 'bugfix'),
      requirement: '订单搜索不到',
      start: false,
      requirements: CHECKLIST,
    });
    const [search] = (await t.call(getRequirementsOp, { id: task.id })).body.items;
    const directory = `/${task.key}`;
    t.fake.enqueue(
      script()
        // Not the verify step: refused, then the step submits as usual.
        .callTool('submit_result', {
          summary: 'Found it',
          requirement_results: [{ item_id: search?.id, conclusion: 'pass', note: 'looks fine' }],
        })
        .callTool('submit_result', { summary: 'Found it' }),
      { title: '· 定位根因', directory },
    );
    t.fake.enqueue(script().edit('search.ts', 'fixed\n').callTool('submit_result', { summary: 'Fixed' }), {
      title: '· 修复',
      directory,
    });
    t.fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: 'Right' }), {
      agent: 'aw-reviewer',
      directory,
    });
    t.fake.enqueue(
      script()
        .callTool('get_task_context')
        .callTool('submit_result', {
          summary: 'Checked',
          requirement_results: [{ item_id: search?.id, conclusion: 'pass', note: 'ran a search for 202610230001' }],
        }),
      { title: '· 核验验收清单', directory },
    );
    const review = reaches(task.id, 'review');
    await t.call(startTaskOp, { id: task.id });
    await review;
    await t.fake.settled();

    const { body: detail } = await t.call(getTaskOp, { id: task.id });
    const verify = detail.nodes.at(-1);
    expect(verify).toMatchObject({ key: 'verify_requirements', kind: 'verify', status: 'done', attemptCount: 1 });
    expect(verify?.dependsOn).toEqual(['fix']);
    const refused = t.fake.toolCalls.find((c) => c.name === 'submit_result' && c.isError);
    expect(refused?.result).toMatchObject({ code: ErrorCode.RequirementResultsInvalid });

    // Every step reads the checklist the work is accepted against.
    const context = t.fake.toolCalls.find((c) => c.name === 'get_task_context')?.result as { requirements: unknown };
    expect(context.requirements).toMatchObject([
      { title: '按订单号搜索', verification: 'ai_review' },
      { title: '单元测试通过', verification: 'command' },
      { title: '能构建', verification: 'command' },
      { title: '窄窗口可用', verification: 'manual' },
    ]);

    const { body: view } = await t.call(getRequirementsOp, { id: task.id });
    expect(statuses(view)).toEqual([
      ['按订单号搜索', 'passed', 'ai'],
      ['单元测试通过', 'failed', 'command'],
      ['能构建', 'passed', 'command'],
      ['窄窗口可用', 'unverified', null],
    ]);
    expect(view.items[0]?.latest?.note).toBe('ran a search for 202610230001');
  });

  it('「再改改」之后再追加一个核验步骤；改动产生新提交，之前的结论过期', async () => {
    const { project } = await addProject(t);
    const { body: task } = await t.call(createTaskOp, {
      projectId: project.id,
      workflowId: await workflowId(t, 'bugfix'),
      requirement: '订单搜索不到',
      start: false,
      requirements: CHECKLIST.slice(0, 2),
    });
    const [search] = (await t.call(getRequirementsOp, { id: task.id })).body.items;
    const directory = `/${task.key}`;
    t.fake.enqueue(script().callTool('submit_result', { summary: 'Found it' }), { title: '· 定位根因', directory });
    t.fake.enqueue(script().edit('search.ts', 'fixed\n').callTool('submit_result', { summary: 'Fixed' }), {
      title: '· 修复',
      directory,
    });
    t.fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: 'Right' }), {
      agent: 'aw-reviewer',
      directory,
    });
    t.fake.enqueue(
      script().callTool('submit_result', {
        summary: 'Checked',
        requirement_results: [{ item_id: search?.id, conclusion: 'pass', note: 'searched' }],
      }),
      { title: '· 核验验收清单', directory },
    );
    let review = reaches(task.id, 'review');
    await t.call(startTaskOp, { id: task.id });
    await review;
    await t.fake.settled();

    t.fake.enqueue(script().edit('search.ts', 'fixed again\n').callTool('submit_result', { summary: 'Changed' }), {
      title: '· 按反馈修改',
      directory,
    });
    // The second verify step gives no AI conclusion: the first one's is about the old commit.
    t.fake.enqueue(script().callTool('submit_result', { summary: 'Checked again' }), {
      title: '· 核验验收清单',
      directory,
    });
    review = reaches(task.id, 'review');
    await t.call(requestChangesOp, { id: task.id, reason: 'user', feedback: 'Ignore case' });
    await review;
    await t.fake.settled();

    const { body: detail } = await t.call(getTaskOp, { id: task.id });
    expect(detail.nodes.slice(-2).map((n) => [n.key, n.kind, n.dependsOn])).toEqual([
      ['revise_1', 'revise', ['verify_requirements']],
      ['verify_requirements_1', 'verify', ['revise_1']],
    ]);
    const { body: view } = await t.call(getRequirementsOp, { id: task.id });
    expect(statuses(view)).toEqual([
      ['按订单号搜索', 'stale', 'ai'],
      ['单元测试通过', 'failed', 'command'],
    ]);
  });

  it('规划流程同样在最后加上核验步骤；没有清单的任务没有它', async () => {
    const { project } = await addProject(t);
    const plan = (taskKey: string) =>
      t.fake.enqueue(script().callTool('submit_plan', planArgs([{ key: 'api' }, finalVerify(['api'])])), {
        agent: 'aw-planner',
        directory: `/${taskKey}`,
      });
    const create = async (requirements?: RequirementItemInput[]) =>
      (
        await t.call(createTaskOp, {
          projectId: project.id,
          workflowId: await workflowId(t, 'feature'),
          requirement: '新增搜索',
          start: false,
          ...(requirements === undefined ? {} : { requirements }),
        })
      ).body;
    const [withList, without] = [await create(CHECKLIST.slice(0, 1)), await create()];
    for (const task of [withList, without]) {
      plan(task.key);
      t.fake.enqueue(script().hang(), { title: '· api', directory: `/${task.key}` });
      const running = reaches(task.id, 'running');
      await t.call(startTaskOp, { id: task.id });
      await running;
    }

    const keys = async (id: string) => (await t.call(getTaskOp, { id })).body.nodes.map((n) => [n.key, n.dependsOn]);
    expect(await keys(withList.id)).toEqual([
      ['api', []],
      ['final_verify', ['api']],
      ['verify_requirements', ['final_verify']],
    ]);
    expect(await keys(without.id)).toEqual([
      ['api', []],
      ['final_verify', ['api']],
    ]);
  });
});
