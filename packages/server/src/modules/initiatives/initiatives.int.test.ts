import { Readable } from 'node:stream';
import {
  type CreateInitiativeRequest,
  confirmInitiativeOp,
  createInitiativeOp,
  createInitiativeTemplateOp,
  createWorkflowOp,
  deleteInitiativeTemplateOp,
  deleteProjectOp,
  deleteWorkflowOp,
  deliverTaskOp,
  ErrorCode,
  getInitiativeOp,
  getTaskOp,
  type InitiativeDetailDTO,
  listInitiativeTemplatesOp,
  openInitiativePhaseOp,
  ServerEventType,
  saveInitiativeDraftOp,
  updateInitiativeTemplateOp,
  validateInitiativeDraft,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, taskReaches, workflowId } from '../../../test/helpers/tasks.ts';

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
const items = (d: InitiativeDetailDTO) => d.items.map((i) => [i.key, i.status, i.task?.key ?? null]);
/** The text of a task's「需求计划背景」attachment (34 §7). */
async function background(taskId: string): Promise<string> {
  const task = (await t.call(getTaskOp, { id: taskId })).body;
  const attachment = task.attachments.find((a) => a.name === '需求计划背景.md');
  if (attachment === undefined) throw new Error(`Task ${task.key} has no background attachment`);
  return t.app.services.attachments.read(attachment.id, 0).text;
}
/** Work started from task events runs after them; wait for it before looking (07 §4: no sleeping). */
const settled = () => t.app.services.initiatives.settled();

describe('组合模板（34 §15）', () => {
  it('内置四个模板，每个都通过阶段与工作包的校验', async () => {
    const { body } = await t.call(listInitiativeTemplatesOp, {});
    expect(body.items.map((tpl) => [tpl.key, tpl.kind])).toEqual([
      ['design_then_build', 'builtin'],
      ['detailed_design_then_build', 'builtin'],
      ['build_then_review', 'builtin'],
      ['tests_then_refactor', 'builtin'],
    ]);
    const workflowExists = (key: string) => t.app.services.workflows.list().some((w) => w.key === key);
    expect(
      body.items.map((tpl) => [tpl.key, validateInitiativeDraft(tpl, { workflowExists, template: true })]),
    ).toEqual(body.items.map((tpl) => [tpl.key, []]));
  });

  it('自定义模板（34 §15.6）：新建、修改、删除；缺 {{requirement}} 或重名不能保存，内置模板只读；需求计划保留快照', async () => {
    const { project } = await addProject(t, { checkCommand: null });
    const template = {
      key: 'review_then_fix',
      name: '审查后修复',
      description: '先审查，再按审查意见修复',
      phases: [
        { title: '审查', goal: '列出问题', autoOpen: false },
        { title: '修复', goal: '问题修掉', autoOpen: true },
      ],
      items: [
        {
          key: 'review',
          title: '审查',
          phase: 1,
          workflow: 'code_review',
          requirement: '审查：{{requirement}}',
          dependsOn: [],
        },
        {
          key: 'fix',
          title: '修复',
          phase: 2,
          workflow: 'bugfix',
          requirement: '按审查意见修复',
          dependsOn: ['review'],
        },
      ],
    };

    const missing = { ...template, items: template.items.map((i) => ({ ...i, requirement: '审查' })) };
    expect((await t.call(createInitiativeTemplateOp, missing)).body).toMatchObject({
      error: {
        code: ErrorCode.InitiativeBreakdownInvalid,
        details: { problems: [{ code: 'TEMPLATE_REQUIREMENT_MISSING' }] },
      },
    });
    const created = await t.call(createInitiativeTemplateOp, template);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ key: 'review_then_fix', kind: 'custom', name: '审查后修复' });
    expect((await t.call(createInitiativeTemplateOp, template)).body).toMatchObject({
      error: { code: ErrorCode.InitiativeTemplateAlreadyExists },
    });
    expect((await t.call(createInitiativeTemplateOp, { ...template, key: 'design_then_build' })).body).toMatchObject({
      error: { code: ErrorCode.InitiativeTemplateAlreadyExists },
    });
    const builtin = (await t.call(listInitiativeTemplatesOp, {})).body.items[0];
    expect((await t.call(updateInitiativeTemplateOp, { ...template, key: builtin?.key ?? '' })).body).toMatchObject({
      error: { code: ErrorCode.InitiativeTemplateReadonly },
    });
    expect((await t.call(deleteInitiativeTemplateOp, { key: builtin?.key ?? '' })).body).toMatchObject({
      error: { code: ErrorCode.InitiativeTemplateReadonly },
    });

    const renamed = await t.call(updateInitiativeTemplateOp, { ...template, name: '先审查再修' });
    expect(renamed.body).toMatchObject({ key: 'review_then_fix', name: '先审查再修' });
    // Custom templates come after the built-in ones.
    expect((await t.call(listInitiativeTemplatesOp, {})).body.items.map((tpl) => tpl.key).at(-1)).toBe(
      'review_then_fix',
    );

    const initiative = await create({
      projectId: project.id,
      templateKey: 'review_then_fix',
      requirement: '订单模块',
      review: true,
    });
    expect(initiative).toMatchObject({
      status: 'draft_ready',
      template: { key: 'review_then_fix', name: '先审查再修' },
      items: [{ key: 'review', requirement: '审查：订单模块' }, { key: 'fix' }],
    });
    expect((await t.call(deleteInitiativeTemplateOp, { key: 'review_then_fix' })).status).toBe(204);
    expect((await t.call(listInitiativeTemplatesOp, {})).body.items.map((tpl) => tpl.key)).not.toContain(
      'review_then_fix',
    );
    expect(await detail(initiative.id)).toMatchObject({
      template: null,
      items: [{ key: 'review', requirement: '审查：订单模块' }, { key: 'fix' }],
    });
    expect((await t.call(updateInitiativeTemplateOp, template)).body).toMatchObject({
      error: { code: ErrorCode.InitiativeTemplateNotFound },
    });
  });

  it('设计后开发：方案设计立即开始；点「完成」后第 2 阶段自动开启，开发任务带着方案报告开始', async () => {
    const { project } = await addProject(t, { checkCommand: null });
    t.fake.enqueue(script().callTool('submit_result', { summary: '推荐方案 B：在 Inventory 上加 byCategory()' }), {
      title: 'T-1 · 方案设计',
    });
    const designDone = taskReaches(t, 'review');

    const created = await create({
      projectId: project.id,
      templateKey: 'design_then_build',
      requirement: '按商品类别统计库存总量',
    });

    expect(created).toMatchObject({
      key: 'I-1',
      title: '按商品类别统计库存总量',
      status: 'in_progress',
      openedPhase: 1,
      template: { key: 'design_then_build', name: '设计后开发' },
    });
    expect(items(created)).toEqual([
      ['design', 'in_task', 'T-1'],
      ['build', 'phase_closed', null],
    ]);
    await designDone;
    await t.fake.settled();
    await settled();
    // A report waiting for「完成」is the gate: the next phase does not open on its own yet (D147).
    expect(items(await detail(created.id))).toEqual([
      ['design', 'in_task', 'T-1'],
      ['build', 'phase_closed', null],
    ]);

    const planning = waitForEvent(
      t.app.events,
      ServerEventType.TaskUpdated,
      (task) => task.key === 'T-2' && task.status === 'failed',
    );
    await t.call(deliverTaskOp, { id: created.items[0]?.task?.id ?? '', strategy: 'report_only' });
    await settled();

    const after = await detail(created.id);
    expect(after).toMatchObject({ status: 'in_progress', openedPhase: 2 });
    expect(items(after)).toEqual([
      ['design', 'satisfied', 'T-1'],
      ['build', 'in_task', 'T-2'],
    ]);
    const buildTask = (await t.call(getTaskOp, { id: after.items[1]?.task?.id ?? '' })).body;
    expect(buildTask).toMatchObject({ title: '按方案开发', workflow: { key: 'feature' } });
    expect(buildTask.requirement).toContain('按商品类别统计库存总量');
    const text = await background(buildTask.id);
    expect(text).toContain('design「方案设计」');
    expect(text).toContain('推荐方案 B：在 Inventory 上加 byCategory()');
    // The planner reads it with the requirement (30 §3.2); this one has no script and fails, which is fine here.
    await planning;
    expect(t.fake.prompts.find((p) => p.text.startsWith('Task T-2'))?.text).toContain('推荐方案 B');
  });
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

const unitTests = (key: string, phase: number, target: string, dependsOn: string[] = []) => ({
  key,
  title: `测 ${target}`,
  phase,
  workflow: 'unit_tests',
  requirement: `为 ${target} 补单元测试`,
  dependsOn,
});

describe('阶段与解锁（34 §5.3–§5.4，D134）', () => {
  it('手动开启的阶段要等前面的工作包合入基础分支；开始后的工作包不能再改', async () => {
    const { repo, project } = await addProject(t, {
      files: { 'a/a.ts': 'export const a = 1;\n', 'b/b.ts': 'export const b = 2;\n' },
      checkCommand: null,
    });
    const created = await create({
      projectId: project.id,
      templateKey: 'tests_then_refactor',
      requirement: '整理 a 与 b',
      review: true,
    });
    expect(created).toMatchObject({ status: 'draft_ready', openedPhase: 0 });
    const draft = {
      phases: [{ title: '一' }, { title: '二' }],
      items: [unitTests('a', 1, 'a/'), unitTests('b', 2, 'b/', ['a'])],
    };
    expect((await t.call(saveInitiativeDraftOp, { id: created.id, ...draft })).status).toBe(200);
    queueUnitTests('T-1', 'a/');
    const aDone = taskReaches(t, 'review');

    const confirmed = (await t.call(confirmInitiativeOp, { id: created.id })).body;

    expect(items(confirmed)).toEqual([
      ['a', 'in_task', 'T-1'],
      ['b', 'phase_closed', null],
    ]);
    await aDone;
    await t.fake.settled();
    // Waiting for review is not merged yet.
    expect((await t.call(openInitiativePhaseOp, { id: created.id, phase: 2 })).body).toMatchObject({
      error: { code: ErrorCode.InitiativePhaseNotReady, details: { items: ['a'] } },
    });
    const edited = {
      ...draft,
      items: [{ ...unitTests('a', 1, 'a/'), requirement: '改了' }, unitTests('b', 2, 'b/', ['a'])],
    };
    expect((await t.call(saveInitiativeDraftOp, { id: created.id, ...edited })).body).toMatchObject({
      error: {
        code: ErrorCode.InitiativeBreakdownInvalid,
        details: { problems: [{ code: 'ITEM_NOT_EDITABLE', itemKey: 'a' }] },
      },
    });

    await t.call(deliverTaskOp, { id: confirmed.items[0]?.task?.id ?? '', strategy: 'squash' });
    await settled();
    const merged = await detail(created.id);
    expect(merged).toMatchObject({ status: 'phase_done', openedPhase: 1 });
    expect(items(merged)).toEqual([
      ['a', 'satisfied', 'T-1'],
      ['b', 'phase_closed', null],
    ]);

    const opened = (await t.call(openInitiativePhaseOp, { id: created.id, phase: 2 })).body;
    expect(items(opened)).toEqual([
      ['a', 'satisfied', 'T-1'],
      ['b', 'in_task', 'T-2'],
    ]);
    const text = await background(opened.items[1]?.task?.id ?? '');
    const head = (await repo.git('rev-parse', 'main')).trim();
    expect(text).toContain(`合入提交：${head}（main）`);
    expect(text).toContain('a/a.test.ts');
  });

  it('报告用的自定义流程在报告完成后被删除，工作包仍算完成（按任务的流程版本判断）', async () => {
    const { project } = await addProject(t, { checkCommand: null });
    const copy = await t.call(createWorkflowOp, {
      copyFrom: await workflowId(t, 'code_review'),
      key: 'my_review',
      name: '我的审查',
    });
    expect(copy.status).toBe(201);
    const created = await create({
      projectId: project.id,
      templateKey: 'design_then_build',
      requirement: '审查',
      review: true,
    });
    await t.call(saveInitiativeDraftOp, {
      id: created.id,
      phases: [{ title: '一' }],
      items: [{ key: 'review', title: '审查', phase: 1, workflow: 'my_review', requirement: '审查 a/' }],
    });
    t.fake.enqueue(script().callTool('submit_result', { summary: 'No issues' }), { title: 'T-1 · 代码审查' });
    const reviewed = taskReaches(t, 'review');
    const confirmed = (await t.call(confirmInitiativeOp, { id: created.id })).body;
    await reviewed;
    await t.fake.settled();
    await t.call(deliverTaskOp, { id: confirmed.items[0]?.task?.id ?? '', strategy: 'report_only' });

    expect((await t.call(deleteWorkflowOp, { key: 'my_review' })).status).toBe(204);

    const after = await detail(created.id);
    expect(after).toMatchObject({ status: 'done', items: [{ status: 'satisfied', deliverable: 'report' }] });
  });

  it('删除项目时需求计划随之删除，资料附件的引用一起释放', async () => {
    const { project } = await addProject(t, { checkCommand: null });
    const bytes = Buffer.from('# 二期需求\n');
    const source = await t.app.services.attachments.upload('需求.md', Readable.from([bytes]), bytes.length);
    const created = await create({
      projectId: project.id,
      templateKey: 'design_then_build',
      requirement: '二期',
      attachmentIds: [source.id],
      review: true,
    });
    expect(created.attachments.map((a) => a.name)).toEqual(['需求.md']);

    expect((await t.call(deleteProjectOp, { id: project.id })).status).toBe(204);

    expect((await t.call(getInitiativeOp, { id: created.id })).status).toBe(404);
    // Removable only once nothing references it.
    await expect(t.app.services.attachments.remove(source.id)).resolves.toBeUndefined();
  });
});
