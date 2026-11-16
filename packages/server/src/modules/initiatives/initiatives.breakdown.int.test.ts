import { Readable } from 'node:stream';
import {
  type CreateInitiativeRequest,
  cancelTaskOp,
  confirmInitiativeOp,
  createInitiativeOp,
  decideRequirementOp,
  deleteInitiativeOp,
  deliverTaskOp,
  ErrorCode,
  getInitiativeOp,
  getRequirementsOp,
  getTaskOp,
  type InitiativeDetailDTO,
  initiativeCoverageTraceOp,
  openInitiativePhaseOp,
  rebreakdownInitiativeOp,
  refineInitiativeOp,
  replaceRequirementsOp,
  saveInitiativeDraftOp,
  startInitiativeItemOp,
  submitBreakdownInputSchema,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { addProject, taskReaches } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

async function create(input: CreateInitiativeRequest): Promise<InitiativeDetailDTO> {
  const res = await t.call(createInitiativeOp, input);
  if (res.status !== 201) throw new Error(`createInitiative failed: ${JSON.stringify(res.body)}`);
  return res.body;
}
const detail = async (id: string) => (await t.call(getInitiativeOp, { id })).body;
const items = (d: InitiativeDetailDTO) => d.items.map((i) => [i.key, i.phase, i.status, i.task?.key ?? null]);
/** Breakdown sessions run in the background; wait for their turns and what they started (07 §4: no sleeping). */
async function settled() {
  await t.fake.settled();
  await t.app.services.initiatives.settled();
}

const SESSION = { agent: 'aw-code-reviewer', title: 'Initiative · I-1' };

const unitTests = (key: string, phase: number, target: string, dependsOn: string[] = []) => ({
  key,
  title: `测 ${target}`,
  phase,
  workflow: 'unit_tests',
  requirement: `为 ${target} 补单元测试`,
  depends_on: dependsOn,
});
const breakdown = (itemsOf: ReturnType<typeof unitTests>[], phases = ['基础', '后续']) => ({
  title: '整理 a 与 b 的测试',
  summary: '先补 a，合入后再补依赖它的 b。',
  understanding: { scope: '补 a、b 两个模块的单元测试', assumptions: ['测试放在模块旁边'] },
  phases: phases.map((title) => ({ title, goal: `${title}完成` })),
  items: itemsOf,
  coverage: itemsOf.map((i) => ({ point: `${i.key} 有测试`, items: [i.key] })),
});

/** The turns of a unit-test task numbered `key` (as in batches.int.test.ts). */
function queueUnitTests(key: string, target: string) {
  t.fake.enqueue(script().callTool('submit_result', { summary: `Gaps in ${target}` }), {
    title: `${key} · 分析测试缺口`,
  });
  t.fake.enqueue(
    script()
      .edit(`${target}${target.slice(0, -1)}.test.ts`, `// tests of ${target}\n`)
      .callTool('submit_result', { summary: `Tested ${target}` }),
    { title: `${key} · 编写测试` },
  );
  t.fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: 'Good tests' }), {
    agent: 'aw-reviewer',
    title: `${key} · `,
  });
}

/** The problem codes of each rejected submit_breakdown call the run's session saw, in order. */
function rejectedProblems(attemptId: string): string[][] {
  return t.app.services.attempts
    .transcript(attemptId, 0)
    .entries.flatMap((e) =>
      e.kind === 'tool_result' && e.data.tool.endsWith('submit_breakdown') && e.data.status === 'error'
        ? [
            [...`${e.data.output ?? ''}${e.data.error ?? ''}`.matchAll(/code\\?"\s*:\s*\\?"([A-Z_]+)/g)]
              .map((m) => m[1] ?? '')
              .filter((code) => code !== ErrorCode.InitiativeBreakdownInvalid),
          ]
        : [],
    );
}

describe('AI 拆解与逐步细化（34 §8，D133、D136）', () => {
  it('拆解先被校验拦下再交出草稿；确认后第 1 阶段开始；进入第 2 阶段前先细化，确认后下游按新需求开始', async () => {
    const { project } = await addProject(t, {
      files: { 'a/a.ts': 'export const a = 1;\n', 'b/b.ts': 'export const b = 2;\n' },
      checkCommand: null,
    });
    t.fake.enqueue(
      script()
        .callTool(
          'submit_breakdown',
          breakdown([unitTests('a', 1, 'a/', ['b']), { ...unitTests('b', 2, 'b/'), workflow: 'feature' }]),
        )
        .callTool('submit_breakdown', breakdown([unitTests('a', 1, 'a/'), unitTests('b', 2, 'b/', ['a'])])),
      SESSION,
    );

    const created = await create({
      projectId: project.id,
      requirement: '整理 a 与 b\n两个模块都要有单元测试。',
      allowedWorkflows: ['unit_tests'],
    });
    expect(created).toMatchObject({ key: 'I-1', title: '整理 a 与 b', allowedWorkflows: ['unit_tests'] });
    await settled();

    const draft = await detail(created.id);
    expect(draft).toMatchObject({
      status: 'draft_ready',
      title: '整理 a 与 b 的测试',
      summary: '先补 a，合入后再补依赖它的 b。',
      openedPhase: 0,
      latestRun: { seq: 1, mode: 'breakdown', status: 'succeeded' },
      coverage: [
        { point: 'a 有测试', items: ['a'] },
        { point: 'b 有测试', items: ['b'] },
      ],
    });
    expect(items(draft)).toEqual([
      ['a', 1, 'phase_closed', null],
      ['b', 2, 'phase_closed', null],
    ]);
    // The first call depended on a later phase and used a workflow outside the allowed ones.
    expect(rejectedProblems(draft.latestRun?.attemptId ?? '')).toEqual([['DEPENDENCY_PHASE', 'WORKFLOW_NOT_ALLOWED']]);
    const first = t.fake.prompts.find((p) => p.text.includes('## The requirement'))?.text ?? '';
    expect(first).toContain('两个模块都要有单元测试。');
    expect(first).toContain('`unit_tests`');
    expect(first).not.toContain('`feature`');
    // The user's edits keep to the allowed workflows too.
    const edited = {
      phases: [{ title: '基础' }, { title: '后续' }],
      items: [
        { ...unitTests('a', 1, 'a/'), workflow: 'feature', dependsOn: [] },
        { ...unitTests('b', 2, 'b/'), workflow: 'feature', dependsOn: ['a'] },
      ],
    };
    expect((await t.call(saveInitiativeDraftOp, { id: created.id, ...edited })).body).toMatchObject({
      error: {
        code: ErrorCode.InitiativeBreakdownInvalid,
        details: { problems: [{ code: 'WORKFLOW_NOT_ALLOWED' }, { code: 'WORKFLOW_NOT_ALLOWED' }] },
      },
    });

    queueUnitTests('T-1', 'a/');
    const aDone = taskReaches(t, 'review');
    expect(items((await t.call(confirmInitiativeOp, { id: created.id })).body)).toEqual([
      ['a', 1, 'in_task', 'T-1'],
      ['b', 2, 'phase_closed', null],
    ]);
    await aDone;
    await t.fake.settled();
    await t.call(deliverTaskOp, { id: (await detail(created.id)).items[0]?.task?.id ?? '', strategy: 'squash' });
    await settled();
    expect(await detail(created.id)).toMatchObject({ status: 'phase_done', openedPhase: 1 });

    // Refinement on the same session: changing the merged work package is refused, then only b is rewritten.
    t.fake.enqueue(
      script()
        .callTool(
          'submit_breakdown',
          breakdown([{ ...unitTests('a', 1, 'a/'), title: '改名' }, unitTests('b', 2, 'b/', ['a'])]),
        )
        .callTool(
          'submit_breakdown',
          breakdown([
            unitTests('a', 1, 'a/'),
            { ...unitTests('b', 2, 'b/', ['a']), requirement: '为 b/ 补单元测试，复用 a 的测试写法' },
          ]),
        ),
      SESSION,
    );
    const refining = (await t.call(openInitiativePhaseOp, { id: created.id, phase: 2, refine: true })).body;
    expect(refining).toMatchObject({ openedPhase: 1, latestRun: { seq: 2, mode: 'refine', openPhase: 2 } });
    await settled();

    const refined = await detail(created.id);
    expect((await t.call(initiativeCoverageTraceOp, { id: created.id })).body.versions.map((v) => v.revision)).toEqual([
      2, 1,
    ]);
    expect(refined).toMatchObject({ status: 'draft_ready', openedPhase: 1 });
    expect(rejectedProblems(refined.latestRun?.attemptId ?? '')).toEqual([['ITEM_NOT_EDITABLE']]);
    const refinePrompt = t.fake.prompts.find((p) => p.text.includes('## Now: refine'))?.text ?? '';
    expect(refinePrompt).toContain('"state": "done"');
    expect(refinePrompt).toContain('a/a.test.ts');

    queueUnitTests('T-2', 'b/');
    const opened = (await t.call(confirmInitiativeOp, { id: created.id })).body;
    expect(opened).toMatchObject({ openedPhase: 2 });
    expect(items(opened)).toEqual([
      ['a', 1, 'satisfied', 'T-1'],
      ['b', 2, 'in_task', 'T-2'],
    ]);
    const bTask = (await t.call(getTaskOp, { id: opened.items[1]?.task?.id ?? '' })).body;
    expect(bTask.requirement).toBe('为 b/ 补单元测试，复用 a 的测试写法');
  });

  it('按显式引用追溯多个工作包与重试任务，保留旧清单结论并区分旧数据', async () => {
    const { project } = await addProject(t, { checkCommand: null });
    const one = {
      ...unitTests('a', 1, 'a/'),
      acceptance: [{ key: 'test_a', title: 'a 的核验', expected: '通过', command: 'true' }],
    };
    const two = {
      ...unitTests('b', 2, 'b/', ['a']),
      acceptance: [{ key: 'test_b', title: 'b 的核验', expected: '通过' }],
    };
    const data = {
      ...breakdown([one, two]),
      coverage: [
        {
          point: '共同需求',
          items: ['a', 'b'],
          links: [
            { item: 'a', acceptance: ['test_a'] },
            { item: 'b', acceptance: ['test_b'] },
          ],
        },
        { point: '旧关联', items: ['a'] },
        { point: '不实现', items: [] },
      ],
    };
    t.fake.enqueue(
      script()
        .callTool('submit_breakdown', {
          ...data,
          coverage: [{ point: '错误关联', items: ['a'], links: [{ item: 'a', acceptance: ['missing'] }] }],
        })
        .callTool('submit_breakdown', data),
      SESSION,
    );
    const created = await create({ projectId: project.id, requirement: '共同需求' });
    await settled();
    const draft = await detail(created.id);
    const firstAcceptance = draft.items[0]?.acceptance[0];
    expect(firstAcceptance).toMatchObject({ sourceKey: 'test_a' });
    expect(firstAcceptance?.id).toBeTruthy();
    expect(draft.coverage?.[0]?.links?.[0]?.acceptance).toEqual([firstAcceptance?.id]);
    expect(rejectedProblems(draft.latestRun?.attemptId ?? '')).toEqual([['INVALID_COVERAGE_LINK']]);
    expect((await t.call(initiativeCoverageTraceOp, { id: created.id })).body.items).toMatchObject([
      { key: 'a', tasks: [] },
      { key: 'b', tasks: [] },
    ]);

    queueUnitTests('T-1', 'a/');
    t.fake.enqueue(script().callTool('submit_result', { summary: 'Checked' }), { title: 'T-1 · 核验验收清单' });
    const running = taskReaches(t, 'review');
    const opened = (await t.call(confirmInitiativeOp, { id: created.id })).body;
    const firstId = opened.items[0]?.task?.id ?? '';
    await running;
    const initial = (await t.call(getRequirementsOp, { id: firstId })).body;
    expect(initial.items[0]?.id).toBe(firstAcceptance?.id);
    expect(initial.commitSha).not.toBeNull();
    await t.call(decideRequirementOp, {
      id: firstId,
      itemId: firstAcceptance?.id ?? '',
      conclusion: 'pass',
      note: '人工确认',
    });
    await t.call(replaceRequirementsOp, {
      id: firstId,
      items: [{ id: firstAcceptance?.id, title: 'a 的核验', expected: '新要求' }],
    });
    const stale = (await t.call(initiativeCoverageTraceOp, { id: created.id })).body.items[0]?.tasks[0]
      ?.requirements[0];
    expect(stale).toMatchObject({ isCurrent: true, status: 'stale', latest: { note: '人工确认' } });
    await t.call(replaceRequirementsOp, { id: firstId, items: [{ title: '替换项', expected: '已更改' }] });
    const removed = (await t.call(initiativeCoverageTraceOp, { id: created.id })).body.items[0]?.tasks[0]?.requirements;
    expect(removed).toContainEqual(
      expect.objectContaining({
        item: expect.objectContaining({ id: firstAcceptance?.id }),
        isCurrent: false,
        revisionId: stale?.revisionId,
        latest: expect.objectContaining({ note: '人工确认' }),
      }),
    );

    await t.call(cancelTaskOp, { id: firstId });
    await t.app.services.initiatives.settled();
    t.fake.enqueue(script().hang(), { title: 'T-2 · 分析测试缺口' });
    const restarted = (await t.call(startInitiativeItemOp, { id: created.id, key: 'a' })).body;
    const secondId = restarted.items[0]?.task?.id ?? '';
    expect(secondId).not.toBe(firstId);
    const trace = (await t.call(initiativeCoverageTraceOp, { id: created.id })).body;
    expect(trace.items[0]?.tasks.map((entry) => entry.task.id)).toEqual([firstId, secondId]);
    expect(trace.items[0]?.tasks[1]?.requirements[0]?.item.id).toBe(firstAcceptance?.id);
    expect(trace.items[1]?.tasks).toEqual([]);
  });

  it('重新拆解移除未启动的包后，旧版本保留原验收要求且同 key 的新包不会继承身份', async () => {
    const { project } = await addProject(t, { checkCommand: null });
    const make = (key: string, title: string) => {
      const item = { ...unitTests(key, 1, 'a/'), acceptance: [{ key: 'check', title, expected: '原预期' }] };
      return {
        ...breakdown([item], ['第一阶段']),
        coverage: [{ point: '原始需求', items: [key], links: [{ item: key, acceptance: ['check'] }] }],
      };
    };
    t.fake.enqueue(script().callTool('submit_breakdown', make('a', '原验收项')), SESSION);
    const created = await create({ projectId: project.id, requirement: '原始需求' });
    await settled();
    const original = await detail(created.id);
    const originalId = original.items[0]?.id;
    const criterionId = original.items[0]?.acceptance[0]?.id;
    t.fake.enqueue(script().callTool('submit_breakdown', make('b', '替代验收项')), SESSION);
    await t.call(rebreakdownInitiativeOp, { id: created.id });
    await settled();
    t.fake.enqueue(script().callTool('submit_breakdown', make('a', '新验收项')), SESSION);
    await t.call(rebreakdownInitiativeOp, { id: created.id });
    await settled();
    const current = await detail(created.id);
    expect(current.items[0]?.id).not.toBe(originalId);
    const trace = (await t.call(initiativeCoverageTraceOp, { id: created.id })).body;
    const old = trace.versions.find((version) => version.revision === 1);
    expect(old?.items).toMatchObject([
      {
        id: originalId,
        key: 'a',
        taskId: null,
        acceptance: [{ id: criterionId, title: '原验收项', expected: '原预期' }],
      },
    ]);
    expect(old?.coverage[0]?.links?.[0]?.acceptance).toEqual([criterionId]);
    expect(current.items[0]?.acceptance[0]?.title).toBe('新验收项');
  });

  it('没有交出拆解就是失败，可以带意见重新拆解；拆解进行中不能修改或删除', async () => {
    const { project } = await addProject(t, { checkCommand: null });
    const notes = Buffer.from('导出字段：订单号、金额\n');
    const source = await t.app.services.attachments.upload('导出.md', Readable.from([notes]), notes.length);
    // No script: the session ends its turn without submitting, is reminded once, and the run fails.
    const created = await create({ projectId: project.id, requirement: '加一个导出功能', attachmentIds: [source.id] });
    // Without a choice, the work packages may use the built-in workflows that change the repository (34 §5.1).
    expect(created.allowedWorkflows).toEqual([
      'feature',
      'bugfix',
      'unit_tests',
      'refactor',
      'cleanup',
      'detailed_design',
      'breakdown',
    ]);
    await settled();
    const first = t.fake.prompts.find((p) => p.text.includes('## The requirement'))?.text ?? '';
    expect(first).toContain('`feature`');
    expect(first).not.toContain('`code_review`');
    // The attachments section names the execution MCP's tools.
    expect(first).toContain('导出字段：订单号、金额');
    expect(first).toContain('read the rest with `agent-workflow_read_attachment`,');
    expect(await detail(created.id)).toMatchObject({
      status: 'breakdown_failed',
      latestRun: { mode: 'breakdown', status: 'failed' },
    });

    t.fake.enqueue(script().hang(), SESSION);
    const again = (await t.call(rebreakdownInitiativeOp, { id: created.id, instruction: '导出 CSV 即可' })).body;
    expect(again).toMatchObject({ status: 'breaking_down', latestRun: { seq: 2, mode: 'rebreakdown' } });
    // The retry carries the user's feedback, though there was no draft to show.
    expect(t.fake.prompts.at(-1)?.text).toContain('导出 CSV 即可');
    const draft = { phases: [{ title: '一' }], items: [{ ...unitTests('a', 1, 'a/'), dependsOn: [] }] };
    expect((await t.call(saveInitiativeDraftOp, { id: created.id, ...draft })).body).toMatchObject({
      error: { code: ErrorCode.InitiativeBusy },
    });
    expect((await t.call(deleteInitiativeOp, { id: created.id })).body).toMatchObject({
      error: { code: ErrorCode.InitiativeBusy },
    });
  });

  it('细化时：已开始的工作包保留用户设的验收项（工具写不出也不算改动）；新草稿确认前不能手动开始其中的工作包', async () => {
    const { project } = await addProject(t, { files: { 'a/a.ts': 'export const a = 1;\n' }, checkCommand: null });
    t.fake.enqueue(script().callTool('submit_breakdown', breakdown([unitTests('a', 1, 'a/')], ['基础'])), SESSION);
    const created = await create({
      projectId: project.id,
      requirement: '补 a 的测试',
      allowedWorkflows: ['unit_tests'],
    });
    await settled();
    // The user marks a's check as a manual, optional one before confirming.
    const acceptance = [
      { title: '人工看一眼', expected: '测试读得懂', required: false, verification: { kind: 'manual' as const } },
    ];
    const saved = await t.call(saveInitiativeDraftOp, {
      id: created.id,
      phases: [{ title: '基础' }],
      items: [{ ...unitTests('a', 1, 'a/'), dependsOn: [], acceptance }],
    });
    expect(saved.status).toBe(200);
    t.fake.enqueue(script().hang(), { title: 'T-1 · ' });
    const confirmed = await t.call(confirmInitiativeOp, { id: created.id });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(items(confirmed.body)).toEqual([['a', 1, 'in_task', 'T-1']]);

    // The refinement keeps a as it is and adds c to the open phase.
    t.fake.enqueue(
      script().callTool('submit_breakdown', breakdown([unitTests('a', 1, 'a/'), unitTests('c', 1, 'c/')], ['基础'])),
      SESSION,
    );
    await t.call(refineInitiativeOp, { id: created.id });
    await settled();
    const refined = await detail(created.id);
    expect(rejectedProblems(refined.latestRun?.attemptId ?? '')).toEqual([]);
    expect(refined).toMatchObject({
      status: 'draft_ready',
      items: [
        { key: 'a', acceptance },
        { key: 'c', status: 'ready' },
      ],
    });

    expect((await t.call(startInitiativeItemOp, { id: created.id, key: 'c' })).body).toMatchObject({
      error: { code: ErrorCode.InitiativeNotEditable },
    });
  });
  it('准备开始一个工作包时细化改写了它：这次开始作废，不按旧需求建任务，也不记为开始失败', async () => {
    const { repo, project } = await addProject(t, { files: { 'a/a.ts': 'export const a = 1;\n' }, checkCommand: null });
    t.fake.enqueue(script().callTool('submit_breakdown', breakdown([unitTests('a', 1, 'a/')], ['基础'])), SESSION);
    const created = await create({ projectId: project.id, requirement: '补 a 的测试' });
    await settled();
    // The automatic start fails while the base branch is away; a waits for the user to start it again.
    await repo.git('branch', '-m', 'main', 'away');
    expect((await t.call(confirmInitiativeOp, { id: created.id })).body).toMatchObject({
      items: [{ key: 'a', status: 'ready', task: null, startError: { code: ErrorCode.GitBaseBranchNotFound } }],
    });
    await repo.git('branch', '-m', 'away', 'main');

    t.fake.enqueue(script().hang(), SESSION);
    const run = (await t.call(refineInitiativeOp, { id: created.id })).body.latestRun;
    const attempt = t.app.services.attempts.get(run?.attemptId ?? '');
    const starting = t.app.services.initiatives.startItem(created.id, 'a');
    // While the start checks the base branch, the refinement rewrites a (no await in between).
    const rewritten = { ...unitTests('a', 1, 'a/'), requirement: '为 a/ 补边界用例' };
    t.app.services.initiatives.submitBreakdown(
      attempt,
      submitBreakdownInputSchema.parse(breakdown([rewritten], ['基础'])),
    );

    await expect(starting).rejects.toMatchObject({ code: ErrorCode.InitiativeItemNotReady });
    expect(await detail(created.id)).toMatchObject({
      status: 'draft_ready',
      items: [
        {
          key: 'a',
          status: 'ready',
          task: null,
          requirement: '为 a/ 补边界用例',
          startError: { code: ErrorCode.GitBaseBranchNotFound },
        },
      ],
    });
  });
});
