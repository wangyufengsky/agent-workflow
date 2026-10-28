import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  archiveFinishedTasksOp,
  archiveTaskOp,
  cancelTaskOp,
  createBatchOp,
  deleteProjectOp,
  deleteTaskOp,
  ErrorCode,
  getTaskOp,
  listTasksOp,
  unarchiveTaskOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { addProject, createTask, nodeReaches, workflowId } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

/** A task cancelled before it started. */
async function cancelledTask(projectId: string, requirement = 'Add a greeting module') {
  const task = await createTask(t, { projectId, workflow: 'bugfix', requirement, start: false });
  return (await t.call(cancelTaskOp, { id: task.id })).body;
}

const keys = async (query: { projectId?: string; archived?: boolean }) =>
  (await t.call(listTasksOp, query)).body.items.map((task) => task.key);

describe('任务归档（42，D218–D220）', () => {
  it('只有结束的任务能归档；归档后列表默认不含、「已归档」只含它，取消归档后回来', async () => {
    const { project } = await addProject(t);
    const draft = await createTask(t, { projectId: project.id, workflow: 'bugfix', start: false });
    expect((await t.call(archiveTaskOp, { id: draft.id })).body).toMatchObject({
      error: { code: ErrorCode.TaskNotFinished, details: { status: 'draft' } },
    });

    const done = await cancelledTask(project.id);
    const archived = (await t.call(archiveTaskOp, { id: done.id })).body;
    expect(archived).toMatchObject({ status: 'cancelled', archivedAt: expect.any(Number) });
    // Nothing about the work changed: the list order stays.
    expect(archived.updatedAt).toBe(done.updatedAt);
    expect(await keys({})).toEqual([draft.key]);
    expect(await keys({ archived: true })).toEqual([done.key]);

    expect((await t.call(unarchiveTaskOp, { id: done.id })).body).toMatchObject({ archivedAt: null });
    expect(await keys({ archived: true })).toEqual([]);
  });

  it('「归档已结束的任务」只动所选项目里已结束且未归档的；不选项目时是全部项目', async () => {
    const { project: a } = await addProject(t);
    const { project: b } = await addProject(t);
    await cancelledTask(a.id, 'one');
    await cancelledTask(a.id, 'two');
    const draft = await createTask(t, { projectId: a.id, workflow: 'bugfix', start: false });
    const other = await cancelledTask(b.id);

    expect((await t.call(archiveFinishedTasksOp, { projectId: a.id })).body).toEqual({ archived: 2 });
    expect(await keys({ projectId: a.id })).toEqual([draft.key]);
    expect(await keys({ projectId: b.id })).toEqual([other.key]);
    expect((await t.call(archiveFinishedTasksOp, {})).body).toEqual({ archived: 1 });
    expect(await keys({})).toEqual([draft.key]);
  });
});

describe('任务删除（42，D221–D223）', () => {
  it('删除结束的任务：记录与会话记录都没了，分支留下，编号不再复用', async () => {
    const { project, repo } = await addProject(t);
    const draft = await createTask(t, { projectId: project.id, workflow: 'bugfix', start: false });
    expect((await t.call(deleteTaskOp, { id: draft.id })).body).toMatchObject({
      error: { code: ErrorCode.TaskNotFinished },
    });

    t.fake.enqueue(script().text('Looking into it').hang(), { title: '定位根因' });
    const running = nodeReaches(t, 'locate', 'running');
    const task = await createTask(t, { projectId: project.id, workflow: 'bugfix' });
    await running;
    const cancelled = (await t.call(cancelTaskOp, { id: task.id, keepBranch: true })).body;
    const runs = join(t.dataDir, 'runs', task.id);
    expect(existsSync(runs)).toBe(true);

    expect((await t.call(deleteTaskOp, { id: task.id })).status).toBe(204);
    expect((await t.call(getTaskOp, { id: task.id })).body).toMatchObject({ error: { code: ErrorCode.TaskNotFound } });
    expect(existsSync(runs)).toBe(false);
    expect((await repo.git('branch', '--list', cancelled.git.branch ?? '')).trim()).not.toBe('');

    // T-2 was the highest number: the next task does not get it again.
    const next = await createTask(t, { projectId: project.id, workflow: 'bugfix', start: false });
    expect(next.key).toBe('T-3');
  });

  it('删除项目后新任务的编号也不复用', async () => {
    const { project } = await addProject(t);
    await cancelledTask(project.id);
    await t.call(deleteProjectOp, { id: project.id });
    const { project: again } = await addProject(t);
    expect((await createTask(t, { projectId: again.id, workflow: 'bugfix', start: false })).key).toBe('T-2');
  });

  it('批量任务里的任务只能归档，不能删除：409 TASK_IN_USE', async () => {
    const { project } = await addProject(t);
    const batch = (
      await t.call(createBatchOp, {
        projectId: project.id,
        workflowId: await workflowId(t, 'bugfix'),
        requirementTemplate: 'Fix {{target}}',
        targets: ['a.ts'],
      })
    ).body;
    const [task] = (await t.call(listTasksOp, {})).body.items;
    if (task === undefined) throw new Error('The batch made no task');
    await t.call(cancelTaskOp, { id: task.id });

    expect((await t.call(deleteTaskOp, { id: task.id })).body).toMatchObject({
      error: { code: ErrorCode.TaskInUse, details: { batchId: batch.id } },
    });
    expect((await t.call(archiveTaskOp, { id: task.id })).body).toMatchObject({ archivedAt: expect.any(Number) });
  });
});
