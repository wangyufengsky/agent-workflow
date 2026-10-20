import { ErrorCode, listInboxOp, listTasksOp } from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { addProject, createTask, inboxOpens, nodeReaches } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

describe('任务与「需要你处理」列表分页（11 §1）', () => {
  it('任务按更新时间倒序分页，nextCursor 取下一页；游标格式不对时 VALIDATION_FAILED', async () => {
    const { project } = await addProject(t);
    for (const requirement of ['one', 'two', 'three']) {
      await createTask(t, { projectId: project.id, workflow: 'bugfix', requirement, start: false });
    }
    const first = (await t.call(listTasksOp, { limit: 2 })).body;
    expect(first.items.map((task) => task.key)).toEqual(['T-3', 'T-2']);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await t.call(listTasksOp, { limit: 2, cursor: first.nextCursor ?? '' })).body;
    expect(second).toMatchObject({ items: [{ key: 'T-1' }], nextCursor: null });
    expect((await t.call(listTasksOp, { cursor: 'next' })).body).toMatchObject({
      error: { code: ErrorCode.ValidationFailed },
    });
  });

  it('按显示状态过滤在分页之前完成：有打开的提问的任务只属于「需要你处理」', async () => {
    const { project } = await addProject(t);
    await createTask(t, { projectId: project.id, workflow: 'bugfix', requirement: 'draft', start: false });
    t.fake.enqueue(script().ask({ question: 'Which environment?', blocking: true }), { title: '· 定位根因' });
    const waiting = nodeReaches(t, 'locate', 'waiting_input');
    const asking = await createTask(t, { projectId: project.id, workflow: 'bugfix', requirement: 'asking' });
    await waiting;

    const keys = async (displayGroup: 'needs_attention' | 'running' | 'preparing') =>
      (await t.call(listTasksOp, { displayGroup, limit: 1 })).body;
    expect(await keys('needs_attention')).toMatchObject({ items: [{ key: asking.key }], nextCursor: null });
    expect(await keys('running')).toEqual({ items: [], nextCursor: null });
    expect(await keys('preparing')).toMatchObject({ items: [{ key: 'T-1' }], nextCursor: null });
  });

  it('「需要你处理」按创建时间倒序分页', async () => {
    const { project } = await addProject(t);
    for (const requirement of ['one', 'two', 'three']) {
      const opened = inboxOpens(t, 'plan');
      await createTask(t, {
        projectId: project.id,
        workflow: 'bugfix',
        requirement,
        checkpoints: { confirm_plan: true },
      });
      await opened;
    }
    const first = (await t.call(listInboxOp, { status: 'open', limit: 2 })).body;
    const second = (await t.call(listInboxOp, { status: 'open', limit: 2, cursor: first.nextCursor ?? '' })).body;
    expect([first.items.length, second.items.length, second.nextCursor]).toEqual([2, 1, null]);
    // Items created in the same millisecond are ordered by id, so only the creation times are compared.
    const items = [...first.items, ...second.items];
    expect(items.map((item) => item.title).sort()).toEqual(['one', 'three', 'two']);
    expect(items.map((item) => item.createdAt)).toEqual(items.map((item) => item.createdAt).sort((a, b) => b - a));
  });
});
