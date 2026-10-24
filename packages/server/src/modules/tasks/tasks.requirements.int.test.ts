import {
  createTaskOp,
  ErrorCode,
  getRequirementsOp,
  type RequirementItemInput,
  replaceRequirementsOp,
  ServerEventType,
  startTaskOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, taskInReview, workflowId } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

async function draftWith(requirements?: RequirementItemInput[]) {
  const { project } = await addProject(t);
  const res = await t.call(createTaskOp, {
    projectId: project.id,
    workflowId: await workflowId(t, 'bugfix'),
    requirement: '订单搜索不到',
    start: false,
    ...(requirements === undefined ? {} : { requirements }),
  });
  expect(res.status).toBe(201);
  return { project, task: res.body };
}

describe('需求验收清单（31，Q-01）', () => {
  it('随任务创建第一个版本：默认必需、AI 核验，尚未核验', async () => {
    const { task } = await draftWith([
      { title: '按订单号搜索', expected: '输入已有订单号，只显示匹配订单' },
      {
        title: '单元测试通过',
        expected: 'pnpm test 退出码 0',
        verification: { kind: 'command', command: 'pnpm test' },
      },
    ]);
    const { body } = await t.call(getRequirementsOp, { id: task.id });
    expect(body.revision).toMatchObject({ seq: 1 });
    expect(body.items).toMatchObject([
      {
        title: '按订单号搜索',
        required: true,
        verification: { kind: 'ai_review' },
        status: 'unverified',
        latest: null,
      },
      { title: '单元测试通过', verification: { kind: 'command', command: 'pnpm test' }, status: 'unverified' },
    ]);
    expect(body.history).toEqual([]);
  });

  it('保存产生新版本：带 id 的项保留，没有 id 的是新项；旧版本进历史；不认识的 id 被拒', async () => {
    const { task } = await draftWith([{ title: '按订单号搜索', expected: '只显示匹配订单' }]);
    const [kept] = (await t.call(getRequirementsOp, { id: task.id })).body.items;
    const { body } = await t.call(replaceRequirementsOp, {
      id: task.id,
      items: [
        { id: kept?.id, title: '按订单号搜索', expected: '只显示匹配订单，忽略大小写', required: false },
        { title: '窄窗口可用', expected: '1024 宽下按钮可点', verification: { kind: 'manual' } },
      ],
    });
    expect(body.revision).toMatchObject({ seq: 2 });
    expect(body.items.map((i) => [i.id === kept?.id, i.title, i.required])).toEqual([
      [true, '按订单号搜索', false],
      [false, '窄窗口可用', true],
    ]);
    expect(body.history.map((h) => h.seq)).toEqual([1]);

    const unknown = await t.call(replaceRequirementsOp, {
      id: task.id,
      items: [{ id: 'not-an-item', title: 'x', expected: 'y' }],
    });
    expect([unknown.status, unknown.raw.json().error.code]).toEqual([400, ErrorCode.ValidationFailed]);
  });

  it('待合并时可以修改，执行中不能', async () => {
    const { project } = await addProject(t);
    const inReview = await taskInReview(t, project.id, { 'a.txt': 'a\n' });
    const saved = await t.call(replaceRequirementsOp, { id: inReview.id, items: [{ title: 'x', expected: 'y' }] });
    expect(saved.body.revision).toMatchObject({ seq: 1 });

    const { task } = await draftWith([{ title: '按订单号搜索', expected: '只显示匹配订单' }]);
    t.fake.enqueue(script().hang(), { title: '· 定位根因', directory: `/${task.key}` });
    const running = waitForEvent(
      t.app.events,
      ServerEventType.TaskUpdated,
      (d) => d.id === task.id && d.status === 'running',
    );
    await t.call(startTaskOp, { id: task.id });
    await running;
    const refused = await t.call(replaceRequirementsOp, { id: task.id, items: [{ title: 'x', expected: 'y' }] });
    expect([refused.status, refused.raw.json().error.code]).toEqual([409, ErrorCode.RequirementsNotEditable]);
  });

  it('没有清单的任务照旧：清单为空', async () => {
    const { task } = await draftWith();
    expect((await t.call(getRequirementsOp, { id: task.id })).body).toEqual({
      revision: null,
      items: [],
      history: [],
    });
  });
});
