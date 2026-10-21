import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  deliverTaskOp,
  ErrorCode,
  getNodeOp,
  getTaskOp,
  listInboxOp,
  requestChangesOp,
  ServerEventType,
  taskDiffOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, taskInReview } from '../../../test/helpers/tasks.ts';
import { runGit } from '../git/index.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const backInReview = (taskId: string) =>
  waitForEvent(t.app.events, ServerEventType.TaskUpdated, (d) => d.id === taskId && d.status === 'review');

describe('交给 AI 解决冲突（13 §4）', () => {
  it('两个任务改同一文件：第二个合并冲突 → 后端在 worktree 预合并 → 解决冲突步骤 → 提交合并 → 再次合并成功', async () => {
    const { repo, project } = await addProject(t, { files: { 'greet.ts': 'export const greet = "hi";\n' } });
    const first = await taskInReview(t, project.id, { 'greet.ts': 'export const greet = "hello";\n' }, 'Say hello');
    const second = await taskInReview(t, project.id, { 'greet.ts': 'export const greet = "hey";\n' }, 'Say hey');
    await t.call(deliverTaskOp, { id: first.id, strategy: 'squash' });
    const { body: conflicted } = await t.call(deliverTaskOp, { id: second.id, strategy: 'squash' });
    expect(conflicted.lastDelivery).toMatchObject({ status: 'conflict', conflictFiles: ['greet.ts'] });

    const worktree = second.git.worktreePath ?? '';
    const resolved = 'export const greet = "hello, hey";\n';
    t.fake.enqueue(script().edit('greet.ts', resolved).callTool('submit_result', { summary: 'Kept both' }), {
      title: '· 解决合并冲突',
      directory: worktree,
    });
    const review = backInReview(second.id);
    const { body: running } = await t.call(requestChangesOp, { id: second.id, reason: 'conflict' });
    expect(running).toMatchObject({ status: 'running' });
    expect(running.nodes.map((n) => [n.key, n.kind, n.dependsOn])).toEqual([
      ['locate', 'normal', []],
      ['fix', 'normal', ['locate']],
      ['resolve_conflict_1', 'revise', ['fix']],
    ]);
    await review;
    await t.fake.settled();

    // The backend merged main into the worktree before the step: the step was told which files conflict, and its
    // commit concludes that merge.
    const prompt = t.fake.prompts.find((p) => p.text.includes('git merge main'));
    expect(prompt?.text).toContain('- `greet.ts`');
    const { body: inReview } = await t.call(getTaskOp, { id: second.id });
    const node = inReview.nodes.find((n) => n.key === 'resolve_conflict_1');
    const { body: detail } = await t.call(getNodeOp, { id: second.id, nodeId: node?.id ?? '' });
    const parents = await runGit(['log', '-1', '--format=%P', detail.commitSha ?? ''], { cwd: worktree });
    expect(parents.stdout.split(' ')).toHaveLength(2);
    // The task's changes are now counted against main, which the merge brought in.
    const mainTip = (await repo.git('rev-parse', 'main')).trim();
    expect((await t.call(taskDiffOp, { id: second.id })).body).toMatchObject({
      base: mainTip,
      files: [{ path: 'greet.ts', additions: 1, deletions: 1 }],
    });
    expect(inReview.result?.filesChanged).toBe(1);
    // Back in review, the earlier conflict no longer describes the task (it would keep offering conflict actions).
    expect(inReview.lastDelivery).toBeNull();

    const { body: done } = await t.call(deliverTaskOp, { id: second.id, strategy: 'squash' });
    expect(done).toMatchObject({ status: 'completed', lastDelivery: { status: 'succeeded' } });
    expect(await readFile(join(repo.path, 'greet.ts'), 'utf8')).toBe(resolved);
  });

  it('上一次交付没有冲突时不能交给 AI 解决冲突', async () => {
    const { project } = await addProject(t);
    const task = await taskInReview(t, project.id, { 'a.txt': 'a\n' });
    const res = await t.call(requestChangesOp, { id: task.id, reason: 'conflict' });
    expect([res.status, res.raw.json().error.code]).toEqual([400, ErrorCode.ValidationFailed]);
  });
});

describe('让 AI 再改改（13 §4）', () => {
  it('按用户反馈追加修改步骤，完成后回到待合并，结果卡包含新的修改', async () => {
    const { project } = await addProject(t);
    const task = await taskInReview(t, project.id, { 'a.txt': 'a\n' });
    t.fake.enqueue(script().edit('b.txt', 'b\n').callTool('submit_result', { summary: 'Added b' }), {
      title: '· 按反馈修改',
      directory: task.git.worktreePath ?? '',
    });
    const review = backInReview(task.id);

    const { body: running } = await t.call(requestChangesOp, {
      id: task.id,
      reason: 'user',
      feedback: 'Also add b.txt',
    });
    expect(running).toMatchObject({
      status: 'running',
      plan: { version: 2, source: 'user', feedback: 'Also add b.txt' },
    });
    expect((await t.call(listInboxOp, { taskId: task.id, status: 'open' })).body.items).toEqual([]);
    await review;
    await t.fake.settled();

    const prompt = t.fake.prompts.find((p) => p.text.includes('Also add b.txt'));
    expect(prompt?.text).toContain('Fixed: Fix the greeting');
    const { body } = await t.call(getTaskOp, { id: task.id });
    expect(body.nodes.map((n) => [n.key, n.status])).toEqual([
      ['locate', 'done'],
      ['fix', 'done'],
      ['revise_1', 'done'],
    ]);
    expect(body.result).toMatchObject({ filesChanged: 2, files: [{ path: 'a.txt' }, { path: 'b.txt' }] });
    expect(body.result?.nodeSummaries.map((s) => s.summary)).toContain('Added b');
  });

  it('没有反馈时拒绝', async () => {
    const { project } = await addProject(t);
    const task = await taskInReview(t, project.id, { 'a.txt': 'a\n' });
    const res = await t.call(requestChangesOp, { id: task.id, reason: 'user' });
    expect([res.status, res.raw.json().error.code]).toEqual([400, ErrorCode.ValidationFailed]);
  });
});
