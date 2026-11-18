import { utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  deliverTaskOp,
  ErrorCode,
  getTaskArtifactOp,
  getTaskDocumentDraftOp,
  getTaskOp,
  NodeStatus,
  reviseTaskArtifactOp,
  startTaskOp,
  TaskStatus,
} from '@aw/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { addProject, createTask, nodeReaches, taskReaches } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

it('草稿只读取工作区已更改的文本文档，其他步骤和较新的二进制文件不遮挡正文', async () => {
  const { project } = await addProject(t, { files: { 'design.md': '# 原始设计' } });
  const task = await createTask(t, { projectId: project.id, workflow: 'detailed_design', start: false });
  t.fake.enqueue(script().callTool('submit_result', { summary: '已梳理' }), { title: '· 梳理现状' });
  t.fake.enqueue(script().hang(), { title: '· 编写详细设计' });
  const writing = nodeReaches(t, 'write', NodeStatus.Running);
  await t.call(startTaskOp, { id: task.id });
  const { node } = await writing;
  const read = async () => (await t.call(getTaskDocumentDraftOp, { id: task.id, nodeId: node.id })).body.draft;
  expect(await read()).toBeNull();
  const tree = t.app.services.worktrees.findByTask(task.id);
  if (!tree) throw new Error('Missing worktree');
  const text = '# 原始设计\n\n## 正在补充的段落';
  await writeFile(join(tree.path, 'design.md'), text);
  await utimes(join(tree.path, 'design.md'), new Date(0), new Date(0));
  await writeFile(join(tree.path, 'other.txt'), Buffer.from([0, 1, 2]));
  expect(await read()).toEqual({ path: 'design.md', text, truncated: false });
  const detail = (await t.call(getTaskOp, { id: task.id })).body;
  const survey = detail.nodes.find(({ id }) => id !== node.id);
  if (!survey) throw new Error('Missing sibling node');
  expect((await t.call(getTaskDocumentDraftOp, { id: task.id, nodeId: survey.id })).body.draft).toBeNull();
  expect(detail.artifact?.versions).toHaveLength(0);
});

it('对非默认文档的标注只修订该文件，交付时同时核对其他文档', async () => {
  const a = 'api.md';
  const b = 'design.md';
  const { project, repo } = await addProject(t, { files: { [a]: '旧接口', [b]: '旧设计' } });
  const task = await createTask(t, { projectId: project.id, workflow: 'detailed_design', start: false });
  const directory = `/${task.key}`;
  t.fake.enqueue(script().callTool('submit_result', { summary: '已梳理' }), { title: '· 梳理现状', directory });
  t.fake.enqueue(script().edit(a, '接口一版').edit(b, '设计一版').callTool('submit_result', { summary: '已编写' }), {
    title: '· 编写详细设计',
    directory,
  });
  const accept = () =>
    t.fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: '通过' }), {
      agent: 'aw-reviewer',
      directory,
    });
  accept();
  const ready = taskReaches(t, TaskStatus.Review);
  await t.call(startTaskOp, { id: task.id });
  await ready;
  const versions = async () => (await t.call(getTaskOp, { id: task.id })).body.artifact?.versions ?? [];
  const initial = await versions();
  expect(initial.map((v) => [v.name, v.number])).toEqual([
    [a, 1],
    [b, 1],
  ]);
  const first = initial[0];
  if (!first) throw new Error('Missing document');
  t.fake.enqueue(script().edit(a, '接口二版').callTool('submit_result', { summary: '已修改接口' }), {
    title: '· 产物修改 1',
    directory,
  });
  accept();
  const revised = taskReaches(t, TaskStatus.Review);
  const change = await t.call(reviseTaskArtifactOp, {
    id: task.id,
    versionId: first.id,
    notes: [{ anchor: { kind: 'whole' }, quote: '', note: '修订接口' }],
  });
  expect(change.status).toBe(200);
  await revised;
  const current = await versions();
  expect(current.map((v) => [v.name, v.number])).toEqual([
    [a, 1],
    [b, 1],
    [a, 2],
  ]);
  await writeFile(join(repo.path, b), '目标分支上的设计');
  await repo.git('commit', '-am', 'change other document');
  const result = await t.call(deliverTaskOp, {
    id: task.id,
    strategy: 'squash',
    artifactVersionId: current.at(-1)?.id,
  });
  expect(result.body.lastDelivery).toMatchObject({ status: 'conflict', conflictFiles: [b] });
});

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
  const correction = '# 订单\n\n权限：管理员和负责人\n\n超时：45 秒\n';
  await writeFile(join(worktree.path, path), correction);
  await repo.git('-C', worktree.path, 'commit', '-am', 'correct the integrated document');
  const corrected = (await t.call(getTaskOp, { id: task.id })).body.artifact?.versions[3];
  if (corrected === undefined) throw new Error('Expected a preview of the subsequent correction');
  expect((await t.call(getTaskArtifactOp, { id: task.id, versionId: corrected.id })).body).toMatchObject({
    text: correction,
  });
  const staleIntegration = await t.call(deliverTaskOp, {
    id: task.id,
    strategy: 'squash',
    artifactVersionId: manual.id,
  });
  expect(staleIntegration.status).toBe(409);
  const delivered = await t.call(deliverTaskOp, { id: task.id, strategy: 'squash', artifactVersionId: corrected.id });
  expect(delivered.body.status).toBe(TaskStatus.Completed);
  expect(await repo.git('show', `main:${path}`)).toBe(correction.trimEnd());
  const oldest = await t.call(getTaskArtifactOp, { id: task.id, versionId: before.id });
  expect(oldest.body).toMatchObject({ text: initial });
});
