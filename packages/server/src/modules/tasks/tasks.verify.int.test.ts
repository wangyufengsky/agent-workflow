import { rm } from 'node:fs/promises';
import {
  createTaskOp,
  decideRequirementOp,
  deliverTaskOp,
  ErrorCode,
  getRequirementsOp,
  getTaskOp,
  getTaskTimelineOp,
  type RequirementItemInput,
  requestChangesOp,
  reverifyRequirementsOp,
  reviseTaskArtifactOp,
  ServerEventType,
  startTaskOp,
  type TaskRequirementsDTO,
  updateSettingsOp,
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
  it('浏览器测试步骤提交报告，验收清单步骤仍提交结构化结论', async () => {
    const { project } = await addProject(t);
    const { body: task } = await t.call(createTaskOp, {
      projectId: project.id,
      workflowId: await workflowId(t, 'browser_test'),
      requirement: '复测订单筛选',
      browserTest: { target: 'http://127.0.0.1:5173/', writes: [] },
      start: false,
      requirements: [{ title: '订单筛选', expected: '只显示已支付订单' }],
    });
    const [filter] = (await t.call(getRequirementsOp, { id: task.id })).body.items;
    if (filter === undefined) throw new Error('missing checklist item');
    t.fake.enqueue(
      script().callTool('get_submission_guide').callTool('browser_submit_report', { summary: '筛选正确' }),
      {
        title: '· 执行浏览器测试',
      },
    );
    t.fake.enqueue(
      script()
        .callTool('browser_submit_report', { summary: '尝试提交清单核验' })
        .callTool('get_submission_guide')
        .callTool('submit_result', {
          summary: '检查通过',
          requirement_results: [{ item_id: filter.id, conclusion: 'pass', note: '正常筛选' }],
        }),
      { title: '· 核验验收清单' },
    );
    const review = reaches(task.id, 'review');
    await t.call(startTaskOp, { id: task.id });
    await review;
    await t.fake.settled();

    expect(t.fake.toolCalls.map(({ isError, name }) => [name, isError])).toEqual([
      ['get_submission_guide', false],
      ['browser_submit_report', false],
      ['browser_submit_report', true],
      ['get_submission_guide', false],
      ['submit_result', false],
    ]);
    expect(t.fake.toolCalls.filter((c) => c.name === 'get_submission_guide').map((c) => c.result)).toMatchObject([
      { tool: 'browser_submit_report', required: ['summary'], allowed: ['summary', 'notes'] },
      {
        tool: 'submit_result',
        example: { requirement_results: [{ item_id: filter.id }] },
        lastRejection: { tool: 'browser_submit_report' },
      },
    ]);
    expect(t.fake.prompts.map(({ text }) => text)).toEqual([
      expect.stringContaining('agent-workflow_browser_submit_report'),
      expect.stringContaining('agent-workflow_submit_result'),
    ]);
    expect((await t.call(getRequirementsOp, { id: task.id })).body.items[0]?.latest?.conclusion).toBe('pass');
  });

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

  it('文档修改后以同一个 Git 提交重新核验，旧版的结论过期', async () => {
    const { project } = await addProject(t);
    const { body: task } = await t.call(createTaskOp, {
      projectId: project.id,
      workflowId: await workflowId(t, 'artifact'),
      requirement: '写一份月度报告',
      start: false,
      requirements: [
        { title: '说明统计范围', expected: '正文注明数据统计范围' },
        { title: '复核数据', expected: '人工确认总计', verification: { kind: 'manual' } },
      ],
    });
    const [scope, totals] = (await t.call(getRequirementsOp, { id: task.id })).body.items;
    if (scope === undefined || totals === undefined) throw new Error('Expected a checklist');
    const directory = `/${task.key}`;
    const write = (text: string) =>
      script()
        .callTool('write_task_text', { file: 'report.md', text })
        .callTool('submit_result', { summary: 'Published' });

    t.fake.enqueue(write('# 月报\n范围：全部客户'), { title: '· 生成首版产物', directory });
    t.fake.enqueue(
      script()
        .callTool('read_task_artifact', { cursor: 0 })
        .callTool('submit_result', {
          summary: 'Checked',
          requirement_results: [{ item_id: scope.id, conclusion: 'pass', note: '范围已注明' }],
        }),
      { title: '· 核验验收清单', directory },
    );
    let review = reaches(task.id, 'review');
    await t.call(startTaskOp, { id: task.id });
    await review;
    const first = (
      await t.call(decideRequirementOp, { id: task.id, itemId: totals.id, conclusion: 'pass', note: '首版已查' })
    ).body;
    expect(first.items.map((item) => item.status)).toEqual(['passed', 'passed']);
    const version = (await t.call(getTaskOp, { id: task.id })).body.artifact?.versions.at(-1);
    if (version === undefined) throw new Error('Expected the first artifact');

    t.fake.enqueue(write('# 月报\n本月总计：120'), { title: '· 产物修改 1', directory });
    t.fake.enqueue(
      script()
        .callTool('read_task_artifact', { cursor: 0 })
        .callTool('submit_result', {
          summary: 'Checked the revised document',
          requirement_results: [{ item_id: scope.id, conclusion: 'fail', note: '新版缺少统计范围' }],
        }),
      { title: '· 核验验收清单', directory },
    );
    review = reaches(task.id, 'review');
    const revision = await t.call(reviseTaskArtifactOp, {
      id: task.id,
      versionId: version.id,
      notes: [{ anchor: { kind: 'whole' }, quote: '', note: '更新月报' }],
    });
    expect(revision.status).toBe(200);
    await review;
    await t.fake.settled();

    const { body: detail } = await t.call(getTaskOp, { id: task.id });
    expect(detail.nodes.slice(-2).map(({ key, dependsOn }) => [key, dependsOn])).toEqual([
      ['artifact_revision_1', ['verify_requirements']],
      ['verify_requirements_1', ['artifact_revision_1']],
    ]);
    expect(
      t.fake.toolCalls.filter(({ name }) => name === 'read_task_artifact').map(({ result }) => result),
    ).toMatchObject([{ text: '# 月报\n范围：全部客户' }, { text: '# 月报\n本月总计：120' }]);
    const { body: rechecked } = await t.call(getRequirementsOp, { id: task.id });
    expect(rechecked.commitSha).toBe(first.commitSha);
    expect(rechecked.items.map((item) => item.status)).toEqual(['failed', 'stale']);
    const delivery = await t.call(deliverTaskOp, {
      id: task.id,
      strategy: 'report_only',
      acknowledgedRequirementsRevisionId: first.revision?.id,
    });
    expect([delivery.status, delivery.raw.json().error.code]).toEqual([409, ErrorCode.RequirementsUnacknowledged]);
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

/** A bug-fix task with `requirements`, run to review; its verify step concludes nothing, so every item is open. */
async function inReviewWith(requirements: RequirementItemInput[]) {
  const { project } = await addProject(t);
  const { body: task } = await t.call(createTaskOp, {
    projectId: project.id,
    workflowId: await workflowId(t, 'bugfix'),
    requirement: '订单搜索不到',
    start: false,
    requirements,
  });
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
  t.fake.enqueue(script().callTool('submit_result', { summary: 'Checked' }), { title: '· 核验验收清单', directory });
  const review = reaches(task.id, 'review');
  await t.call(startTaskOp, { id: task.id });
  await review;
  await t.fake.settled();
  const { body: view } = await t.call(getRequirementsOp, { id: task.id });
  return { task, view };
}

describe('人工结论、重新核验与交付提醒（31 §2.3、§4，Q-03）', () => {
  it('待合并时用户可以给结论：接受未完成必须写原因；不在待合并时不行', async () => {
    const { task, view } = await inReviewWith(CHECKLIST.slice(0, 2));
    const [search, tests] = view.items;
    const noReason = await t.call(decideRequirementOp, { id: task.id, itemId: tests?.id ?? '', conclusion: 'waive' });
    expect([noReason.status, noReason.raw.json().error.code]).toEqual([400, ErrorCode.ValidationFailed]);

    await t.call(decideRequirementOp, { id: task.id, itemId: search?.id ?? '', conclusion: 'pass', note: '亲自试过' });
    const { body } = await t.call(decideRequirementOp, {
      id: task.id,
      itemId: tests?.id ?? '',
      conclusion: 'waive',
      note: '测试环境暂时没有数据库',
    });
    expect(statuses(body)).toEqual([
      ['按订单号搜索', 'passed', 'user'],
      ['单元测试通过', 'waived', 'user'],
    ]);

    t.fake.enqueue(script().hang(), { title: '· 核验验收清单', directory: `/${task.key}` });
    const running = reaches(task.id, 'running');
    await t.call(reverifyRequirementsOp, { id: task.id });
    await running;
    const late = await t.call(decideRequirementOp, { id: task.id, itemId: search?.id ?? '', conclusion: 'pass' });
    expect([late.status, late.raw.json().error.code]).toEqual([409, ErrorCode.RequirementsNotEditable]);
  });

  it('核验步骤失败后用修改的清单恢复，不重新执行开发步骤', async () => {
    await t.call(updateSettingsOp, { 'node.maxAttempts': 1 });
    const { project } = await addProject(t);
    const { body: task } = await t.call(createTaskOp, {
      projectId: project.id,
      workflowId: await workflowId(t, 'bugfix'),
      requirement: '修复',
      start: false,
      requirements: CHECKLIST.slice(2, 3),
    });
    const directory = `/${task.key}`;
    t.fake.enqueue(script().callTool('submit_result', { summary: 'Found' }), { title: '· 定位根因', directory });
    t.fake.enqueue(script().edit('search.ts', 'fixed\n').callTool('submit_result', { summary: 'Fixed' }), {
      title: '· 修复',
      directory,
    });
    t.fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: 'Right' }), {
      agent: 'aw-reviewer',
      directory,
    });
    t.fake.enqueue(script().error('APIError', 'Bad Gateway'), { title: '· 核验验收清单', directory });
    const failed = reaches(task.id, 'failed');
    await t.call(startTaskOp, { id: task.id });
    await failed;
    const before = (await t.call(getTaskOp, { id: task.id })).body;
    const view = (await t.call(getRequirementsOp, { id: task.id })).body;
    t.fake.enqueue(script().callTool('submit_result', { summary: 'Checked' }), { title: '· 核验验收清单', directory });
    const review = reaches(task.id, 'review');
    const response = await t.call(reverifyRequirementsOp, {
      id: task.id,
      revisionId: view.revision?.id ?? '',
      expectedCommitSha: view.commitSha ?? '',
      items: [{ title: '新条件', expected: '成功', verification: { kind: 'command', command: 'true' } }],
    });
    expect(response.status).toBe(200);
    await review;
    const after = (await t.call(getTaskOp, { id: task.id })).body;
    expect(after.nodes.find((node) => node.key === 'fix')?.attemptCount).toBe(
      before.nodes.find((node) => node.key === 'fix')?.attemptCount,
    );
    expect((await t.call(getRequirementsOp, { id: task.id })).body.commitSha).toBe(view.commitSha);
    expect((await t.call(getRequirementsOp, { id: task.id })).body.items[0]?.title).toBe('新条件');
  });

  it('工作区不存在时拒绝重验，任务仍待合并', async () => {
    const { task, view } = await inReviewWith(CHECKLIST.slice(2, 3));
    const detail = (await t.call(getTaskOp, { id: task.id })).body;
    if (detail.git.worktreePath === null) throw new Error('No worktree');
    await rm(detail.git.worktreePath, { recursive: true, force: true });
    const response = await t.call(reverifyRequirementsOp, {
      id: task.id,
      revisionId: view.revision?.id ?? '',
      expectedCommitSha: view.commitSha ?? '',
      items: [{ title: '不应保存', expected: '成功' }],
    });
    expect(response.status).not.toBe(200);
    expect((await t.call(getTaskOp, { id: task.id })).body.status).toBe('review');
  });

  it('修改清单并重新核验是同一个操作，旧版本并发提交被拒绝', async () => {
    const { task, view } = await inReviewWith(CHECKLIST.slice(2, 3));
    const revisionId = view.revision?.id ?? '';
    const wrongHead = await t.call(reverifyRequirementsOp, {
      id: task.id,
      revisionId,
      expectedCommitSha: 'outdated',
      items: [{ title: '不应保存', expected: '成功' }],
    });
    expect(wrongHead.status).toBe(409);
    expect((await t.call(getRequirementsOp, { id: task.id })).body.revision?.id).toBe(revisionId);
    t.fake.enqueue(script().callTool('submit_result', { summary: 'Checked again' }), {
      title: '· 核验验收清单',
      directory: `/${task.key}`,
    });
    const review = reaches(task.id, 'review');
    const changed = await t.call(reverifyRequirementsOp, {
      id: task.id,
      revisionId,
      expectedCommitSha: view.commitSha ?? '',
      items: [{ title: '更新后的要求', expected: '退出码 0', verification: { kind: 'command', command: 'true' } }],
    });
    expect(changed.body.status).toBe('running');
    await review;
    const { body: current } = await t.call(getRequirementsOp, { id: task.id });
    expect(current.revision?.id).not.toBe(revisionId);
    expect(current.items[0]?.title).toBe('更新后的要求');
    expect(current.history.map((r) => r.id)).toContain(revisionId);
    const timeline = (await t.call(getTaskTimelineOp, { id: task.id })).body.items;
    expect(timeline.find((event) => event.type === 'requirements_reverified')?.payload).toMatchObject({
      previousRevisionId: revisionId,
      revisionId: current.revision?.id,
      commitSha: view.commitSha,
    });
    const stale = await t.call(reverifyRequirementsOp, {
      id: task.id,
      revisionId,
      expectedCommitSha: view.commitSha ?? '',
      items: [{ title: '旧页面覆盖', expected: '退出码 0', verification: { kind: 'command', command: 'true' } }],
    });
    expect(stale.status).toBe(409);
    expect((await t.call(getRequirementsOp, { id: task.id })).body.items[0]?.title).toBe('更新后的要求');
  });

  it('重新核验追加一个核验步骤，按当前清单再跑一遍', async () => {
    const { task } = await inReviewWith(CHECKLIST.slice(2, 3));
    t.fake.enqueue(script().callTool('submit_result', { summary: 'Checked again' }), {
      title: '· 核验验收清单',
      directory: `/${task.key}`,
    });
    const review = reaches(task.id, 'review');
    const { body: running } = await t.call(reverifyRequirementsOp, { id: task.id });
    expect(running.nodes.at(-1)).toMatchObject({
      key: 'verify_requirements_1',
      kind: 'verify',
      dependsOn: ['verify_requirements'],
    });
    await review;
    await t.fake.settled();
    const { body: view } = await t.call(getRequirementsOp, { id: task.id });
    expect(statuses(view)).toEqual([['能构建', 'passed', 'command']]);
  });

  it('有未满足的必需项时，交付要确认当前这一版清单；交付记下清单摘要', async () => {
    const { task, view } = await inReviewWith([
      ...CHECKLIST.slice(0, 1),
      { title: '文档', expected: '写了说明', required: false },
    ]);
    const refused = await t.call(deliverTaskOp, { id: task.id, strategy: 'squash' });
    expect([refused.status, refused.raw.json().error]).toMatchObject([
      409,
      {
        code: ErrorCode.RequirementsUnacknowledged,
        details: { revisionId: view.revision?.id, items: [{ title: '按订单号搜索' }] },
      },
    ]);
    const stale = await t.call(deliverTaskOp, {
      id: task.id,
      strategy: 'squash',
      acknowledgedRequirementsRevisionId: 'v0',
    });
    expect(stale.raw.json().error.code).toBe(ErrorCode.RequirementsUnacknowledged);

    const { body: done } = await t.call(deliverTaskOp, {
      id: task.id,
      strategy: 'squash',
      acknowledgedRequirementsRevisionId: view.revision?.id ?? '',
    });
    expect(done.status).toBe('completed');
    const { body: timeline } = await t.call(getTaskTimelineOp, { id: task.id });
    const delivered = timeline.items.find(
      (e) => e.entity === 'delivery' && e.payload !== null && 'requirements' in e.payload,
    );
    expect(delivered?.payload).toMatchObject({
      requirements: {
        revisionId: view.revision?.id,
        items: [
          { title: '按订单号搜索', required: true, status: 'unverified' },
          { title: '文档', required: false, status: 'unverified' },
        ],
      },
    });
  });
});
