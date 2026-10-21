import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type BatchDetailDTO,
  createBatchOp,
  deleteProjectOp,
  deliverBatchOp,
  ErrorCode,
  getBatchOp,
  getTaskOp,
  listBatchesOp,
  ServerEventType,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, workflowId } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const MODULES = {
  'a/a.ts': 'export const a = 1;\n',
  'b/b.ts': 'export const b = 2;\n',
  'c/c.ts': 'export const c = 3;\n',
};
const TARGETS = ['a/', 'b/', 'c/'];
const testFile = (target: string) => `${target}${target.slice(0, -1)}.test.ts`;

/** Resolves once every task of the batch reached `status` (subscribe before creating the batch, 07 §4). */
function allReach(count: number, status: string): Promise<void> {
  const reached = new Set<string>();
  return waitForEvent(t.app.events, ServerEventType.TaskUpdated, (task) => {
    if (task.status === status) reached.add(task.id);
    return reached.size === count;
  }).then(() => undefined);
}

/**
 * The turns of each unit-test task: tasks are numbered T-1… in target order in a fresh app, so each task's sessions
 * are told apart by the key in their title; the test step writes a test next to its target.
 */
function queueUnitTests(targets: readonly string[]) {
  targets.forEach((target, i) => {
    const key = `T-${i + 1} · `;
    t.fake.enqueue(script().callTool('submit_result', { summary: `Gaps in ${target}` }), {
      title: `${key}分析测试缺口`,
    });
    t.fake.enqueue(
      script()
        .edit(testFile(target), `// tests of ${target}\n`)
        .callTool('submit_result', { summary: `Tested ${target}` }),
      { title: `${key}编写测试` },
    );
    t.fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: 'Good tests' }), {
      agent: 'aw-reviewer',
      title: key,
    });
  });
}

async function createBatch(projectId: string, workflow: string, template: string, targets: string[]) {
  const res = await t.call(createBatchOp, {
    projectId,
    workflowId: await workflowId(t, workflow),
    requirementTemplate: template,
    targets,
  });
  if (res.status !== 201) throw new Error(`createBatch failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

const detail = async (batch: BatchDetailDTO) => (await t.call(getBatchOp, { id: batch.id })).body;

describe('批量任务：创建与运行（20 §2–§4）', () => {
  it('每个目标一个普通任务：需求为模板替换结果、计划不需确认、各自分支与 worktree，各自跑完到待合并', async () => {
    const { project } = await addProject(t, { files: MODULES, checkCommand: null });
    queueUnitTests(TARGETS);
    const review = allReach(3, 'review');

    const batch = await createBatch(project.id, 'unit_tests', '为 {{target}} 补单元测试\n只测 {{target}}', TARGETS);

    expect(batch).toMatchObject({ key: 'B-1', title: '为 {{target}} 补单元测试', total: 3, baseBranch: 'main' });
    expect(batch.items.map((i) => [i.position, i.target, i.task.key])).toEqual([
      [0, 'a/', 'T-1'],
      [1, 'b/', 'T-2'],
      [2, 'c/', 'T-3'],
    ]);
    await review;
    await t.fake.settled();

    const tasks = await Promise.all(batch.items.map(async (i) => (await t.call(getTaskOp, { id: i.task.id })).body));
    expect(tasks.map((task) => task.requirement)).toEqual(TARGETS.map((x) => `为 ${x} 补单元测试\n只测 ${x}`));
    expect(tasks.map((task) => task.title)).toEqual(TARGETS.map((x) => `为 ${x} 补单元测试`));
    expect(tasks.every((task) => !task.checkpoints.confirm_plan)).toBe(true);
    expect(new Set(tasks.map((task) => task.git.branch)).size).toBe(3);
    expect(new Set(tasks.map((task) => task.git.worktreePath)).size).toBe(3);
    // Each task changed only its own target.
    expect(tasks.map((task) => task.result?.files.map((f) => f.path))).toEqual(TARGETS.map((x) => [testFile(x)]));

    const progress = await detail(batch);
    expect(progress).toMatchObject({ counts: [{ group: 'review', count: 3 }], ended: 0 });
    const list = (await t.call(listBatchesOp, { projectId: project.id })).body;
    expect(list).toMatchObject({ items: [{ id: batch.id, total: 3, counts: [{ group: 'review', count: 3 }] }] });
  });

  it('AI 规划的流程不能批量：400 VALIDATION_FAILED，不创建任何任务', async () => {
    const { project } = await addProject(t);
    const res = await t.call(createBatchOp, {
      projectId: project.id,
      workflowId: await workflowId(t, 'feature'),
      requirementTemplate: '给 {{target}} 加日志',
      targets: ['a/'],
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: { code: ErrorCode.ValidationFailed, details: { issues: [{ path: ['workflowId'] }] } },
    });
    expect((await t.call(listBatchesOp, {})).body.items).toEqual([]);
  });

  it('不存在的批次：404 BATCH_NOT_FOUND', async () => {
    const res = await t.call(getBatchOp, { id: 'missing' });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: ErrorCode.BatchNotFound } });
  });
});

describe('批量交付（20 §5）', () => {
  it('一个任务冲突，其余照常合并；冲突的留在待合并，再次批量交付不包含它', async () => {
    const { repo, project } = await addProject(t, { files: MODULES, checkCommand: null });
    queueUnitTests(TARGETS);
    const review = allReach(3, 'review');
    const batch = await createBatch(project.id, 'unit_tests', '为 {{target}} 补单元测试', TARGETS);
    await review;
    await t.fake.settled();
    // main gets its own version of b's test file meanwhile: merging T-2 conflicts.
    await writeFile(join(repo.path, testFile('b/')), '// written on main\n');
    await repo.git('add', '-A');
    await repo.git('commit', '-q', '-m', 'tests of b on main');

    const { status, body } = await t.call(deliverBatchOp, { id: batch.id, strategy: 'squash' });

    expect(status).toBe(200);
    expect(body.outcomes.map((o) => [o.taskKey, o.target, o.outcome])).toEqual([
      ['T-1', 'a/', 'delivered'],
      ['T-2', 'b/', 'conflict'],
      ['T-3', 'c/', 'delivered'],
    ]);
    expect(body.outcomes[1]?.error).toMatchObject({ code: ErrorCode.DeliveryConflict });
    expect(body.batch.items.map((i) => [i.task.status, i.lastDelivery?.status])).toEqual([
      ['completed', 'succeeded'],
      ['review', 'conflict'],
      ['completed', 'succeeded'],
    ]);
    expect((await repo.git('log', '--format=%s', 'main')).trim().split('\n')).toEqual([
      '为 c/ 补单元测试 (T-3)',
      '为 a/ 补单元测试 (T-1)',
      'tests of b on main',
      'init',
    ]);
    expect(await repo.git('show', `main:${testFile('b/')}`)).toBe('// written on main');

    expect((await t.call(deliverBatchOp, { id: batch.id })).body.outcomes).toEqual([]);
  });

  it('报告类流程：批量「完成」全部报告；删除项目后批次随之删除', async () => {
    const { project } = await addProject(t, { files: MODULES, checkCommand: null });
    ['a/', 'b/'].forEach((target, i) => {
      t.fake.enqueue(script().callTool('submit_result', { summary: `Review of ${target}: fine` }), {
        title: `T-${i + 1} · 代码审查`,
      });
    });
    const review = allReach(2, 'review');
    const batch = await createBatch(project.id, 'code_review', '审查 {{target}}', ['a/', 'b/']);
    await review;
    await t.fake.settled();

    const { body } = await t.call(deliverBatchOp, { id: batch.id, strategy: 'merge' });

    expect(body.outcomes.map((o) => o.outcome)).toEqual(['delivered', 'delivered']);
    expect(body.batch.items.map((i) => i.lastDelivery?.strategy)).toEqual(['report_only', 'report_only']);
    expect(body.batch).toMatchObject({ ended: 2, counts: [{ group: 'completed', count: 2 }] });

    expect((await t.call(deleteProjectOp, { id: project.id })).status).toBe(204);
    expect((await t.call(getBatchOp, { id: batch.id })).status).toBe(404);
  });
});
