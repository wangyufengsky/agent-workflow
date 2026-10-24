import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cancelTaskOp,
  createProjectOp,
  ErrorCode,
  getTaskOp,
  gitBranchesOp,
  gitCommitOp,
  gitDiffFileOp,
  gitDiffOp,
  gitFetchOp,
  gitFileOp,
  gitLogOp,
  gitStatusOp,
  gitTreeOp,
  listWorktreesOp,
  pruneWorktreesOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';
import { createTask, taskReaches } from '../../../test/helpers/tasks.ts';
import { runGit } from '../git/index.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

/** A repository with a second commit, a subdirectory, a binary file and a bare `origin`. */
async function setUp() {
  const origin = await mkdtemp(join(tmpdir(), 'aw-origin-'));
  await runGit(['init', '-q', '--bare', origin], { cwd: origin });
  const repo = await createTestRepo({ files: { 'src/a.ts': 'export const a = 1;\n' }, origin });
  await repo.git('push', '-q', '-u', 'origin', 'main');
  await writeFile(join(repo.path, 'src/a.ts'), 'export const a = 2;\n');
  await writeFile(join(repo.path, 'logo.bin'), Buffer.from([0, 1, 2]));
  await repo.git('add', '-A');
  await repo.git('commit', '-q', '-m', 'second', '-m', 'with a body');
  const { body: project } = await t.call(createProjectOp, { repoPath: repo.path });
  return { repo, origin, project };
}

describe('Git 管理台（读取仓库）', () => {
  it('状态：当前分支、相对上游领先、未提交与未跟踪的改动', async () => {
    const { repo, project } = await setUp();
    await writeFile(join(repo.path, 'README.md'), 'changed\n');
    await writeFile(join(repo.path, 'new.txt'), 'new\n');

    const { body } = await t.call(gitStatusOp, { id: project.id });
    expect(body).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 1, behind: 0, clean: false });
    expect(body.files).toEqual([
      { path: 'README.md', code: '.M' },
      { path: 'new.txt', code: '??' },
    ]);
  });

  it('分支：本地与远端分支，任务分支标注所属任务；拉取后出现远端新分支', async () => {
    const { origin, project } = await setUp();
    const running = taskReaches(t, 'running');
    const task = await createTask(t, { projectId: project.id, workflow: 'bugfix', requirement: 'Fix it' });
    await running;
    await t.call(cancelTaskOp, { id: task.id, keepBranch: true });
    const other = await createTestRepo();
    await other.git('push', '-q', origin, 'main:refs/heads/from-elsewhere');

    await t.call(gitFetchOp, { id: project.id });
    const { body } = await t.call(gitBranchesOp, { id: project.id });
    expect(body.items.map((b) => [b.name, b.remote, b.current, b.task?.key ?? null])).toEqual([
      ['aw/T-1-fix-it', false, false, 'T-1'],
      ['main', false, true, null],
      ['origin/from-elsewhere', true, false, null],
      ['origin/main', true, false, null],
    ]);
    expect(body.items.find((b) => b.name === 'main')).toMatchObject({ upstream: 'origin/main', ahead: 1 });
  });

  it('提交记录分页；提交详情含改动文件，根提交与空树比较', async () => {
    const { project } = await setUp();
    const first = await t.call(gitLogOp, { id: project.id, ref: 'main', limit: 1 });
    expect(first.body.items.map((c) => [c.subject, c.body])).toEqual([['second', 'with a body']]);
    expect(first.body.nextCursor).toBe('1');
    const second = await t.call(gitLogOp, { id: project.id, ref: 'main', limit: 1, cursor: '1' });
    expect(second.body).toMatchObject({ items: [{ subject: 'init', parents: [] }], nextCursor: null });

    const head = first.body.items[0]?.sha ?? '';
    const { body: detail } = await t.call(gitCommitOp, { id: project.id, sha: head });
    expect(detail.files).toEqual([
      { path: 'logo.bin', status: 'added', additions: null, deletions: null },
      { path: 'src/a.ts', status: 'modified', additions: 1, deletions: 1 },
    ]);
    const root = await t.call(gitCommitOp, { id: project.id, sha: second.body.items[0]?.sha ?? '' });
    expect(root.body.files.map((f) => [f.path, f.status])).toEqual([
      ['README.md', 'added'],
      ['src/a.ts', 'added'],
    ]);
    // A root commit's files diff against the empty tree it reports as its base.
    const rootFile = await t.call(gitDiffFileOp, {
      id: project.id,
      from: root.body.base,
      to: root.body.sha,
      path: 'README.md',
    });
    expect('diff' in rootFile.body && rootFile.body.diff).toContain('+# test');
    const missing = await t.call(gitCommitOp, { id: project.id, sha: 'no-such-ref' });
    expect([missing.status, missing.raw.json().error.code]).toEqual([404, ErrorCode.NotFound]);
  });

  it('按日期取起点：分支自己的历史上那天之前的最后一个提交，不取之后才合并进来的旧提交', async () => {
    const repo = await createTestRepo();
    // Every commit dated, the merged side commit later than main's own last commit before the day.
    const commitAt = (date: string, message: string) =>
      runGit(
        [
          '-c',
          'user.name=aw-test',
          '-c',
          'user.email=aw-test@example.com',
          'commit',
          '-q',
          '--allow-empty',
          '-m',
          message,
        ],
        {
          cwd: repo.path,
          env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
        },
      );
    await commitAt('2026-09-20T10:00:00+08:00', 'a');
    await commitAt('2026-09-28T10:00:00+08:00', 'b');
    await repo.git('switch', '-q', '-c', 'side', 'HEAD~1');
    await commitAt('2026-09-30T10:00:00+08:00', 'side');
    await repo.git('switch', '-q', 'main');
    await runGit(
      [
        '-c',
        'user.name=aw-test',
        '-c',
        'user.email=aw-test@example.com',
        'merge',
        '-q',
        '--no-ff',
        '-m',
        'merge side',
        'side',
      ],
      {
        cwd: repo.path,
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: '2026-10-03T10:00:00+08:00',
          GIT_COMMITTER_DATE: '2026-10-03T10:00:00+08:00',
        },
      },
    );
    await commitAt('2026-10-05T10:00:00+08:00', 'c');
    const { body: project } = await t.call(createProjectOp, { repoPath: repo.path });

    const before = new Date('2026-10-01T00:00:00+08:00').getTime();
    const { body } = await t.call(gitLogOp, { id: project.id, ref: 'main', limit: 1, before });
    expect(body.items.map((c) => c.subject)).toEqual(['b']);
    const none = await t.call(gitLogOp, {
      id: project.id,
      ref: 'main',
      limit: 1,
      before: new Date('2026-09-01').getTime(),
    });
    expect(none.body.items).toEqual([]);
  });

  it('任意两个版本的 diff：文件列表与单文件 unified diff', async () => {
    const { project } = await setUp();
    const { body } = await t.call(gitDiffOp, { id: project.id, from: 'main~1', to: 'main' });
    expect(body.files.map((f) => f.path)).toEqual(['logo.bin', 'src/a.ts']);
    const file = await t.call(gitDiffFileOp, { id: project.id, from: 'main~1', to: 'main', path: 'src/a.ts' });
    expect(file.body).toMatchObject({ path: 'src/a.ts' });
    expect('diff' in file.body && file.body.diff).toContain('-export const a = 1;\n+export const a = 2;');
  });

  it('目录浏览（目录在前）与文件内容；二进制不返回内容，不存在的路径 404', async () => {
    const { project } = await setUp();
    const root = await t.call(gitTreeOp, { id: project.id, ref: 'main' });
    expect(root.body.items.map((e) => [e.path, e.type])).toEqual([
      ['src', 'tree'],
      ['logo.bin', 'blob'],
      ['README.md', 'blob'],
    ]);
    const src = await t.call(gitTreeOp, { id: project.id, ref: 'main', path: 'src' });
    expect(src.body.items).toEqual([{ name: 'a.ts', path: 'src/a.ts', type: 'blob', size: 20 }]);

    expect((await t.call(gitFileOp, { id: project.id, ref: 'main~1', path: 'src/a.ts' })).body).toEqual({
      path: 'src/a.ts',
      content: 'export const a = 1;\n',
    });
    expect((await t.call(gitFileOp, { id: project.id, ref: 'main', path: 'logo.bin' })).body).toEqual({
      path: 'logo.bin',
      binary: true,
    });
    expect((await t.call(gitFileOp, { id: project.id, ref: 'main', path: 'nope.txt' })).status).toBe(404);
  });
});

describe('worktree 总览与清理（M4-08）', () => {
  it('列出主工作区、任务 worktree（标注任务）与其他 worktree；清理终态任务遗留的 worktree（保留分支）并 prune', async () => {
    const { repo, project } = await setUp();
    const running = taskReaches(t, 'running');
    const created = await createTask(t, { projectId: project.id, workflow: 'bugfix', requirement: 'Fix it' });
    await running;
    const { body: task } = await t.call(getTaskOp, { id: created.id });
    const managed = task.git.worktreePath ?? '';
    await writeFile(join(managed, 'wip.txt'), 'wip\n');
    const side = join(await mkdtemp(join(tmpdir(), 'aw-side-')), 'wt');
    await repo.git('worktree', 'add', '-q', '-b', 'side', side);
    const gone = join(await mkdtemp(join(tmpdir(), 'aw-gone-')), 'wt');
    await repo.git('worktree', 'add', '-q', '--detach', gone);
    await rm(gone, { recursive: true });

    const { body } = await t.call(listWorktreesOp, { id: project.id });
    const row = (w: (typeof body.items)[number]) => [
      w.branch,
      w.main,
      w.managed,
      w.task?.key ?? null,
      w.dirty,
      w.prunable,
    ];
    expect(body.items[0]?.main).toBe(true);
    expect(body.items.map(row).sort()).toEqual(
      [
        ['main', true, false, null, false, false],
        [task.git.branch, false, true, 'T-1', true, false],
        ['side', false, false, null, false, false],
        [null, false, false, null, null, true],
      ].sort(),
    );
    expect(body.items.find((w) => w.branch === 'side')).toMatchObject({ ahead: 0, behind: 0 });

    // Removing the worktree fails while it is locked: the task is cancelled, its worktree is left behind.
    await repo.git('worktree', 'lock', managed);
    await t.call(cancelTaskOp, { id: task.id });
    expect(t.app.services.worktrees.findByTask(task.id)?.status).toBe('error');
    await repo.git('worktree', 'unlock', managed);

    const pruned = await t.call(pruneWorktreesOp, { id: project.id });
    expect(pruned.body.items.map((w) => w.branch).sort()).toEqual(['main', 'side']);
    expect(existsSync(managed)).toBe(false);
    expect(t.app.services.worktrees.findByTask(task.id)?.status).toBe('removed');
    expect(await repo.git('branch', '--list', task.git.branch ?? '', '--format=%(refname:short)')).toBe(
      task.git.branch,
    );
  });
});
