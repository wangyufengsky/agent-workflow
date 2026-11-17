import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  deliverTaskOp,
  ErrorCode,
  getTaskArtifactOp,
  getTaskOp,
  reviseTaskArtifactOp,
  startTaskOp,
  TaskStatus,
} from '@aw/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { addProject, createTask, taskReaches } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

it('目标分支更新同一文档后先重新审阅，已合并任务仍可读版本快照', async () => {
  const path = 'orders.md';
  const { project, repo } = await addProject(t, { files: { [path]: '# 订单\n\n权限：旧规则\n\n超时：旧配置\n' } });
  const task = await createTask(t, { projectId: project.id, workflow: 'detailed_design', start: false });
  const directory = `/${task.key}`;
  const initial = '# 订单\n\n权限：仅管理员\n\n超时：旧配置\n';
  t.fake.enqueue(script().callTool('submit_result', { summary: '已梳理' }), { title: '· 梳理现状', directory });
  t.fake.enqueue(script().edit(path, initial).callTool('submit_result', { summary: '已编写设计' }), {
    title: '· 编写详细设计',
    directory,
  });
  const accept = () =>
    t.fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: '设计符合要求' }), {
      agent: 'aw-reviewer',
      directory,
    });
  accept();
  const first = taskReaches(t, TaskStatus.Review);
  await t.call(startTaskOp, { id: task.id });
  await first;
  const before = (await t.call(getTaskOp, { id: task.id })).body.artifact?.versions[0];
  expect(before).toMatchObject({ repository: { path }, number: 1 });
  if (before === undefined) throw new Error('Expected the first version');

  t.fake.enqueue(
    script()
      .edit(path, initial.replace('仅管理员', '管理员和负责人'))
      .callTool('submit_result', { summary: '扩展权限' }),
    { title: '· 产物修改 1', directory },
  );
  accept();
  const revised = taskReaches(t, TaskStatus.Review);
  const revision = await t.call(reviseTaskArtifactOp, {
    id: task.id,
    versionId: before.id,
    notes: [
      {
        anchor: { kind: 'paragraph', heading: '订单', lines: { from: 3, to: 3 } },
        quote: '权限：仅管理员',
        note: '增加负责人',
      },
    ],
  });
  expect(revision.status).toBe(200);
  await revised;
  const latest = (await t.call(getTaskOp, { id: task.id })).body.artifact?.versions[1];
  if (latest === undefined) throw new Error('Expected the revised version');
  const stale = await t.call(deliverTaskOp, { id: task.id, strategy: 'squash', artifactVersionId: before.id });
  expect([stale.status, stale.raw.json().error.code]).toEqual([409, ErrorCode.StateTransitionInvalid]);

  await writeFile(join(repo.path, path), '# 订单\n\n权限：旧规则\n\n超时：30 秒\n');
  await repo.git('add', path);
  await repo.git('commit', '-m', 'update timeout separately');
  const conflict = await t.call(deliverTaskOp, { id: task.id, strategy: 'squash', artifactVersionId: latest.id });
  expect(conflict.body).toMatchObject({
    status: TaskStatus.Review,
    lastDelivery: { status: 'conflict', conflictFiles: [path] },
  });
  expect(await repo.git('show', `main:${path}`)).toContain('权限：旧规则');

  const worktree = t.app.services.worktrees.findByTask(task.id);
  if (worktree === undefined) throw new Error('Expected the task worktree');
  await repo.git('-C', worktree.path, 'merge', '--no-edit', 'main');
  const manual = (await t.call(getTaskOp, { id: task.id })).body.artifact?.versions[2];
  if (manual === undefined) throw new Error('Expected a preview of the manually integrated document');
  expect((await t.call(getTaskArtifactOp, { id: task.id, versionId: manual.id })).body).toMatchObject({
    text: '# 订单\n\n权限：管理员和负责人\n\n超时：30 秒\n',
  });
  const delivered = await t.call(deliverTaskOp, { id: task.id, strategy: 'squash', artifactVersionId: manual.id });
  expect(delivered.body.status).toBe(TaskStatus.Completed);
  const oldest = await t.call(getTaskArtifactOp, { id: task.id, versionId: before.id });
  expect(oldest.body).toMatchObject({ text: initial });
});
