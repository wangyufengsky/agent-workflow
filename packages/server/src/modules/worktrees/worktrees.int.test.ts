import { existsSync } from 'node:fs';
import { ErrorCode } from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { addProject, createTask } from '../../../test/helpers/tasks.ts';
import { branchName } from './worktrees.service.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

describe('worktrees', () => {
  it('分支名为 aw/<任务编号>-<标题转写>，标题无 ASCII 时只用编号', () => {
    expect(branchName('T-12', 'Add CSV export (v2)')).toBe('aw/T-12-add-csv-export-v2');
    expect(branchName('T-3', '退款单分页')).toBe('aw/T-3');
  });

  it('同一仓库并发为 5 个任务创建 worktree，全部就绪且互不干扰', async () => {
    const { repo, project } = await addProject(t);
    const tasks = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createTask(t, { projectId: project.id, workflow: 'bugfix', requirement: `Task ${i}`, start: false }),
      ),
    );
    const { worktrees } = t.app.services;
    const created = await Promise.all(
      tasks.map((task) =>
        worktrees.create({
          taskId: task.id,
          taskKey: task.key,
          title: task.title,
          projectId: project.id,
          projectSlug: project.slug,
          repoPath: repo.path,
          baseBranch: 'main',
        }),
      ),
    );

    const head = (await repo.git('rev-parse', 'main')).trim();
    expect(created.map((w) => [w.status, w.baseCommit, existsSync(w.path)])).toEqual(
      tasks.map(() => ['ready', head, true]),
    );
    const listed = await repo.git('worktree', 'list', '--porcelain');
    for (const w of created) expect(listed).toContain(`branch refs/heads/${w.branch}`);
    expect(new Set(created.map((w) => w.path)).size).toBe(5);
  });

  it('删除 worktree 与分支；保留分支时只删 worktree', async () => {
    const { repo, project } = await addProject(t);
    const [kept, dropped] = await Promise.all(
      ['Keep me', 'Drop me'].map((requirement) =>
        createTask(t, { projectId: project.id, workflow: 'bugfix', requirement, start: false }),
      ),
    );
    if (kept === undefined || dropped === undefined) throw new Error('tasks not created');
    const make = (task: typeof kept) =>
      t.app.services.worktrees.create({
        taskId: task.id,
        taskKey: task.key,
        title: task.title,
        projectId: project.id,
        projectSlug: project.slug,
        repoPath: repo.path,
        baseBranch: 'main',
      });
    const [a, b] = await Promise.all([make(kept), make(dropped)]);

    await t.app.services.worktrees.remove(a, { repoPath: repo.path, deleteBranch: false });
    await t.app.services.worktrees.remove(b, { repoPath: repo.path, deleteBranch: true });

    expect(t.app.services.worktrees.findByTask(kept.id)).toMatchObject({ status: 'removed' });
    expect([existsSync(a.path), existsSync(b.path)]).toEqual([false, false]);
    expect(await repo.git('branch', '--list', 'aw/*', '--format=%(refname:short)')).toBe(a.branch);
  });

  it('分支已存在时创建失败：worktree 记为 error，返回 WORKTREE_CREATE_FAILED', async () => {
    const { repo, project } = await addProject(t);
    const task = await createTask(t, { projectId: project.id, workflow: 'bugfix', requirement: 'Clash', start: false });
    await repo.git('branch', branchName(task.key, task.title));

    await expect(
      t.app.services.worktrees.create({
        taskId: task.id,
        taskKey: task.key,
        title: task.title,
        projectId: project.id,
        projectSlug: project.slug,
        repoPath: repo.path,
        baseBranch: 'main',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.WorktreeCreateFailed });
    expect(t.app.services.worktrees.findByTask(task.id)).toMatchObject({ status: 'error' });
  });
});
