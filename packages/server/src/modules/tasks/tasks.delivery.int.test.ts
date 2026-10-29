import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  deliverTaskOp,
  ErrorCode,
  getTaskOp,
  getTaskTimelineOp,
  listInboxOp,
  type TaskDetailDTO,
  TeamPeriod,
  teamSummaryOp,
  updateSettingsOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import type { TestRepo } from '../../../test/helpers/git.ts';
import { addProject, taskInReview } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const GREET = { 'greet.ts': 'export const greet = () => "hi";\n' };
const FIXED = { 'greet.ts': 'export const greet = () => "hello";\n' };

async function inReview(edits: Record<string, string> = FIXED) {
  const { repo, project } = await addProject(t, { files: GREET });
  const task = await taskInReview(t, project.id, edits);
  return { repo, project, task };
}

const log = (repo: TestRepo, ...args: string[]) => repo.git('log', '--format=%s|%P|%an', ...args);
const openDeliveryItems = async (task: TaskDetailDTO) =>
  (await t.call(listInboxOp, { taskId: task.id, status: 'open' })).body.items.filter((i) => i.kind === 'delivery');

describe('交付：本地合并（09 §7）', () => {
  it('任务提交与 squash 提交带发起人 trailer，团队页把它们算在发起人名下；仓库没有配置邮箱时不加（D130）', async () => {
    const { repo, project } = await addProject(t, { files: GREET });
    await repo.git('config', 'user.name', 'Zhang San');
    await repo.git('config', 'user.email', 'zs@corp.com');
    const task = await taskInReview(t, project.id, FIXED);
    const trailer = 'Agent-Workflow-Requested-By: Zhang San <zs@corp.com>';
    // git ends the trailers with a newline of their own.
    const trailers = async (ref: string) =>
      (await repo.git('log', '-1', '--format=%an|%(trailers:only,unfold)', ref)).trim();
    expect(await trailers(task.git.branch ?? '')).toBe(`agent-workflow|${trailer}`);

    await t.call(deliverTaskOp, { id: task.id, strategy: 'squash' });
    expect(await trailers('main')).toBe(`agent-workflow|${trailer}`);
    const { body } = await t.call(teamSummaryOp, { id: project.id, period: TeamPeriod.Last30Days });
    expect(body.members.find((m) => m.key === 'zs@corp.com')?.metrics).toMatchObject({ commits: 1, taskCommits: 1 });
    expect(body.others).toEqual([]);

    await repo.git('config', 'user.email', '');
    const other = await taskInReview(t, project.id, { 'greet.ts': 'export const greet = () => "hey";\n' });
    expect(await trailers(other.git.branch ?? '')).toBe('agent-workflow|');
  });

  it('设置了提交人时任务提交与 squash 提交都用它，团队页仍算发起人经 AI 任务的提交（D227）', async () => {
    const { repo, project } = await addProject(t, { files: GREET });
    await repo.git('config', 'user.name', 'Zhang San');
    await repo.git('config', 'user.email', 'zs@corp.com');
    await t.call(updateSettingsOp, { 'git.commitIdentity': { name: 'Corp Bot', email: 'bot@corp.com' } });
    const task = await taskInReview(t, project.id, FIXED);
    const identities = (ref: string) => repo.git('log', '-1', '--format=%an <%ae>|%cn <%ce>', ref);
    expect(await identities(task.git.branch ?? '')).toBe('Corp Bot <bot@corp.com>|Corp Bot <bot@corp.com>');

    await t.call(deliverTaskOp, { id: task.id, strategy: 'squash' });
    expect(await identities('main')).toBe('Corp Bot <bot@corp.com>|Corp Bot <bot@corp.com>');
    const { body } = await t.call(teamSummaryOp, { id: project.id, period: TeamPeriod.Last30Days });
    expect(body.members.find((m) => m.key === 'zs@corp.com')?.metrics).toMatchObject({ commits: 1, taskCommits: 1 });
    expect(body.members.map((m) => m.key)).not.toContain('bot@corp.com');
  });

  it('squash：主工作区在目标分支上，合并为一个提交；任务完成，worktree 与分支已清理，交付条目已处理', async () => {
    const { repo, task } = await inReview();
    const before = (await repo.git('rev-parse', 'main')).trim();

    const { status, body } = await t.call(deliverTaskOp, { id: task.id, strategy: 'squash' });

    expect(status).toBe(200);
    const tip = (await repo.git('rev-parse', 'main')).trim();
    expect(body).toMatchObject({
      status: 'completed',
      lastDelivery: { strategy: 'squash', targetBranch: 'main', status: 'succeeded', commitSha: tip },
      git: { worktreeStatus: 'removed' },
    });
    expect((await log(repo, '-1', 'main')).trim()).toBe(`Fix the greeting (${task.key})|${before}|agent-workflow`);
    // The user's checkout of main follows the merge.
    expect(await readFile(join(repo.path, 'greet.ts'), 'utf8')).toBe(FIXED['greet.ts']);
    expect(await repo.git('status', '--porcelain')).toBe('');
    expect(existsSync(task.git.worktreePath ?? '')).toBe(false);
    expect(await repo.git('branch', '--list', 'aw/*')).toBe('');
    expect(await openDeliveryItems(body)).toEqual([]);
    const timeline = (await t.call(getTaskTimelineOp, { id: task.id })).body.items;
    expect(timeline.filter((e) => e.entity === 'task').map((e) => e.toStatus)).toEqual([
      'preparing',
      'running',
      'review',
      'merging',
      'completed',
    ]);
  });

  it('merge：目标分支未检出时在临时 worktree 中合并，主工作区的其他分支与未提交改动不受影响；按设置保留分支', async () => {
    const { repo, task } = await inReview();
    await t.call(updateSettingsOp, { 'delivery.deleteBranchAfterMerge': false });
    await repo.git('checkout', '-q', '-b', 'mine');
    await writeFile(join(repo.path, 'scratch.txt'), 'my work in progress\n');

    const { body } = await t.call(deliverTaskOp, { id: task.id, strategy: 'merge' });

    expect(body).toMatchObject({ status: 'completed', lastDelivery: { status: 'succeeded' } });
    const [subject, parents] = (await log(repo, '-1', 'main')).trim().split('|');
    expect(subject).toBe(`Fix the greeting (${task.key})`);
    expect(parents?.split(' ')).toHaveLength(2);
    expect(await repo.git('show', 'main:greet.ts')).toBe(FIXED['greet.ts'].trimEnd());
    expect([await repo.git('branch', '--show-current'), await repo.git('status', '--porcelain')]).toEqual([
      'mine',
      '?? scratch.txt',
    ]);
    expect(await repo.git('worktree', 'list', '--porcelain')).not.toContain('aw-merge-');
    expect(await repo.git('branch', '--list', 'aw/*', '--format=%(refname:short)')).toBe(task.git.branch);
  });

  it('rebase：目标分支前进后，任务提交接在目标分支之后，历史保持线性', async () => {
    const { repo, task } = await inReview();
    await writeFile(join(repo.path, 'OTHER.md'), 'other\n');
    await repo.git('add', '-A');
    await repo.git('commit', '-q', '-m', 'meanwhile on main');

    const { body } = await t.call(deliverTaskOp, { id: task.id, strategy: 'rebase' });

    expect(body).toMatchObject({ status: 'completed', lastDelivery: { status: 'succeeded' } });
    const subjects = (await repo.git('log', '--format=%s', '--first-parent', 'main')).split('\n');
    expect(subjects.slice(1)).toEqual(['meanwhile on main', 'init']);
    expect(subjects[0]).toMatch(new RegExp(`^${task.key} `));
    expect(await repo.git('rev-list', '--merges', 'main')).toBe('');
    expect(await readFile(join(repo.path, 'greet.ts'), 'utf8')).toBe(FIXED['greet.ts']);
  });

  it('冲突：中止合并恢复原状，任务回到待合并，记录冲突文件，交付条目仍打开', async () => {
    const { repo, task } = await inReview();
    await writeFile(join(repo.path, 'greet.ts'), 'export const greet = () => "hey";\n');
    await repo.git('commit', '-q', '-am', 'conflicting change on main');
    const before = (await repo.git('rev-parse', 'main')).trim();

    const { body } = await t.call(deliverTaskOp, { id: task.id, strategy: 'squash' });

    expect(body).toMatchObject({
      status: 'review',
      lastDelivery: { status: 'conflict', conflictFiles: ['greet.ts'], error: { code: ErrorCode.DeliveryConflict } },
      git: { worktreeStatus: 'ready' },
    });
    expect((await repo.git('rev-parse', 'main')).trim()).toBe(before);
    expect(await repo.git('status', '--porcelain')).toBe('');
    expect(await openDeliveryItems(body)).toHaveLength(1);
  });

  it('主工作区在目标分支且有未提交改动：拒绝合并，不碰用户的改动，任务保持待合并', async () => {
    const { repo, task } = await inReview();
    await writeFile(join(repo.path, 'README.md'), 'my unsaved edit\n');

    const res = await t.call(deliverTaskOp, { id: task.id, strategy: 'squash' });

    expect(res.status).toBe(409);
    expect(res.raw.json().error).toMatchObject({
      code: ErrorCode.DeliveryTargetDirty,
      details: { branch: 'main', files: ['README.md'] },
    });
    expect(await readFile(join(repo.path, 'README.md'), 'utf8')).toBe('my unsaved edit\n');
    expect((await t.call(getTaskOp, { id: task.id })).body).toMatchObject({ status: 'review', lastDelivery: null });
  });

  it('git 失败：交付记为失败，任务回到待合并可再试；目标分支不存在与报告策略用错各有错误码', async () => {
    const { repo, task } = await inReview();
    expect((await t.call(deliverTaskOp, { id: task.id, strategy: 'squash', targetBranch: 'nope' })).status).toBe(400);
    expect((await t.call(deliverTaskOp, { id: task.id, strategy: 'report_only' })).status).toBe(400);
    // Another git process holds the index of the main worktree.
    await writeFile(join(repo.path, '.git', 'index.lock'), '');

    const { body } = await t.call(deliverTaskOp, { id: task.id, strategy: 'squash' });

    expect(body).toMatchObject({
      status: 'review',
      lastDelivery: { status: 'failed', error: { code: ErrorCode.GitCommandFailed } },
    });
  });

  it('应用在交付中退出：重启后交付记为中断，任务回到待合并', async () => {
    const { task } = await inReview();
    await t.close();
    // What the previous run left when it stopped during the merge.
    const db = new DatabaseSync(join(t.dataDir, 'app.db'));
    db.prepare(`UPDATE tasks SET status = 'merging' WHERE id = ?`).run(task.id);
    db.prepare(
      `INSERT INTO deliveries (id, task_id, strategy, target_branch, status, created_at) VALUES ('d1', ?, 'squash', 'main', 'running', 0)`,
    ).run(task.id);
    db.prepare(
      `INSERT INTO task_events (task_id, entity, entity_id, type, to_status, created_at) VALUES (?, 'delivery', 'd1', 'note', 'running', 0)`,
    ).run(task.id);
    db.close();

    t = await createTestApp({ dataDir: t.dataDir });

    expect((await t.call(getTaskOp, { id: task.id })).body).toMatchObject({
      status: 'review',
      lastDelivery: { id: 'd1', status: 'failed', error: { code: ErrorCode.DeliveryInterrupted } },
    });
  });
});
