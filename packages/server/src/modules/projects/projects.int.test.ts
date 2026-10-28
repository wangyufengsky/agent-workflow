import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  createProjectOp,
  deleteProjectOp,
  deliverTaskOp,
  ErrorCode,
  GIT_INIT_LARGE_FILE_BYTES,
  getProjectOp,
  initGitOp,
  listProjectsOp,
  previewGitInitOp,
  TaskStatus,
  updateProjectOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';
import { taskInReview } from '../../../test/helpers/tasks.ts';
import { runGit } from '../git/index.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const nodeRepo = () =>
  createTestRepo({
    files: { 'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }), 'pnpm-lock.yaml': '' },
    origin: 'git@github.com:acme/order-service.git',
  });

describe('添加项目', () => {
  it('添加仓库根目录：读取默认分支、推断检查命令与远端', async () => {
    const repo = await nodeRepo();
    const res = await t.call(createProjectOp, { repoPath: repo.path, name: 'Order Service' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Order Service',
      slug: 'order-service',
      repoPath: repo.path,
      defaultBranch: 'main',
      checkCommand: 'pnpm test',
      hosting: null,
      inferredHosting: { provider: 'github', baseUrl: null, repo: 'acme/order-service' },
    });
    expect((await t.call(listProjectsOp, {})).body.items.map((p) => p.id)).toEqual([res.body.id]);
  });

  it('远端默认分支与仓库检出的分支不同时，项目详情同时给出两者（D216）', async () => {
    const repo = await nodeRepo();
    // origin's default is main (an empty branch in the user's case); the work happens on dev.
    await repo.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    await repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    await repo.git('checkout', '-q', '-b', 'dev');
    const { body } = await t.call(createProjectOp, { repoPath: repo.path });
    expect({ defaultBranch: body.defaultBranch, currentBranch: body.currentBranch }).toEqual({
      defaultBranch: 'main',
      currentBranch: 'dev',
    });
    await repo.git('checkout', '-q', '--detach');
    expect((await t.call(getProjectOp, { id: body.id })).body.currentBranch).toBeNull();
  });

  it('未给名称时用目录名，同名 slug 自动加序号', async () => {
    const a = await t.call(createProjectOp, { repoPath: (await createTestRepo()).path, name: 'app' });
    const b = await t.call(createProjectOp, { repoPath: (await createTestRepo()).path, name: 'App' });
    const c = await t.call(createProjectOp, { repoPath: (await createTestRepo()).path });
    expect([a.body.slug, b.body.slug]).toEqual(['app', 'app-2']);
    expect(c.body.name).toMatch(/^aw-repo-/);
  });

  it('不在任何 Git 仓库里的目录返回 400 PROJECT_PATH_NO_GIT', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aw-plain-'));
    const res = await t.call(createProjectOp, { repoPath: dir });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: ErrorCode.ProjectPathNoGit } });
  });

  it('仓库子目录与不存在的路径返回 400 PROJECT_PATH_NOT_GIT_REPO，也不能初始化 Git', async () => {
    const repo = await createTestRepo();
    await mkdir(join(repo.path, 'src'));
    for (const repoPath of [join(repo.path, 'src'), join(repo.path, 'missing')]) {
      const responses = [
        await t.call(createProjectOp, { repoPath }),
        await t.call(previewGitInitOp, { repoPath }),
        await t.call(initGitOp, { repoPath }),
      ];
      for (const res of responses) {
        expect(res.body).toMatchObject({ error: { code: ErrorCode.ProjectPathNotGitRepo } });
      }
    }
    expect(existsSync(join(repo.path, 'src', '.git'))).toBe(false);
  });

  it('同一仓库重复添加返回 409 PROJECT_ALREADY_EXISTS', async () => {
    const repo = await createTestRepo();
    await t.call(createProjectOp, { repoPath: repo.path });
    const res = await t.call(createProjectOp, { repoPath: repo.path });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: ErrorCode.ProjectAlreadyExists } });
  });

  it('HEAD 游离且没有 origin 默认分支时返回 400 GIT_BASE_BRANCH_NOT_FOUND', async () => {
    const repo = await createTestRepo();
    await repo.git('checkout', '-q', '--detach');
    const res = await t.call(createProjectOp, { repoPath: repo.path });
    expect(res.body).toMatchObject({ error: { code: ErrorCode.GitBaseBranchNotFound } });
  });
});

describe('修改与删除项目', () => {
  it('修改名称、默认分支与检查命令（可清空）', async () => {
    const repo = await nodeRepo();
    await repo.git('branch', 'develop');
    const { body: created } = await t.call(createProjectOp, { repoPath: repo.path });
    const res = await t.call(updateProjectOp, {
      id: created.id,
      name: '订单服务',
      defaultBranch: 'develop',
      checkCommand: null,
    });
    expect(res.body).toMatchObject({ name: '订单服务', defaultBranch: 'develop', checkCommand: null });
    expect((await t.call(getProjectOp, { id: created.id })).body.name).toBe('订单服务');
  });

  it('添加时推断页面预览；修改后读回同样的设置，可清空，地址不是来源时拒绝', async () => {
    const repo = await createTestRepo({
      files: { 'package.json': JSON.stringify({ scripts: { dev: 'vite' } }), 'pnpm-lock.yaml': '' },
    });
    const { body: created } = await t.call(createProjectOp, { repoPath: repo.path });
    expect(created.preview).toMatchObject({ command: 'pnpm run dev --port $PORT --strictPort', pages: ['/'] });

    const preview = {
      command: 'pnpm dev --port $PORT',
      setupCommand: null,
      readyPath: '/health',
      pages: ['/', '/orders'],
      extraOrigins: ['http://127.0.0.1:8080'],
    };
    await t.call(updateProjectOp, { id: created.id, preview });
    expect((await t.call(getProjectOp, { id: created.id })).body.preview).toEqual(preview);
    expect((await t.call(updateProjectOp, { id: created.id, preview: null })).body.preview).toBeNull();

    const invalid = await t.call(updateProjectOp, {
      id: created.id,
      preview: { ...preview, extraOrigins: ['http://127.0.0.1:8080/api'] },
    });
    expect(invalid.status).toBe(400);
  });

  it('默认分支不存在时返回 400 GIT_BASE_BRANCH_NOT_FOUND', async () => {
    const { body: created } = await t.call(createProjectOp, { repoPath: (await createTestRepo()).path });
    const res = await t.call(updateProjectOp, { id: created.id, defaultBranch: 'nope' });
    expect(res.body).toMatchObject({ error: { code: ErrorCode.GitBaseBranchNotFound } });
  });

  it('删除后再取返回 404 PROJECT_NOT_FOUND', async () => {
    const { body: created } = await t.call(createProjectOp, { repoPath: (await createTestRepo()).path });
    expect((await t.call(deleteProjectOp, { id: created.id })).status).toBe(204);
    const res = await t.call(getProjectOp, { id: created.id });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: ErrorCode.ProjectNotFound } });
  });
});

/** A directory in no repository holding `files`. */
async function plainDir(files: Record<string, string>): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'aw-plain-')));
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), content);
  }
  return dir;
}

/** Runs `fn` with `config` as git's global configuration, standing in for what the user set up. */
async function withGlobalGitConfig<T>(config: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.GIT_CONFIG_GLOBAL;
  const file = join(await mkdtemp(join(tmpdir(), 'aw-gitconfig-')), 'config');
  await writeFile(file, config);
  process.env.GIT_CONFIG_GLOBAL = file;
  try {
    return await fn();
  } finally {
    process.env.GIT_CONFIG_GLOBAL = previous;
  }
}

const git = async (cwd: string, ...args: string[]) => (await runGit(args, { cwd })).stdout;

describe('为没有 Git 的目录初始化 Git（D153）', () => {
  it('预览将纳入的文件与 .gitignore，初始化后照常添加项目并跑通一个任务', async () => {
    const dir = await plainDir({
      'package.json': '{}',
      'src/greet.js': 'hello\n',
      'node_modules/left-pad/index.js': 'pad\n',
    });

    const { body: preview } = await t.call(previewGitInitOp, { repoPath: dir });
    expect(preview).toEqual({
      files: 3,
      bytes: 2 + 6 + 'node_modules/\n.DS_Store\n'.length,
      largeFiles: [],
      largeFileCount: 0,
      gitignore: 'node_modules/\n.DS_Store\n',
    });
    expect(existsSync(join(dir, '.git'))).toBe(false);

    const res = await t.call(initGitOp, { repoPath: dir });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ repoPath: dir, defaultBranch: 'main' });
    expect(await git(dir, 'ls-files')).toBe('.gitignore\npackage.json\nsrc/greet.js');
    // The test machine has no git identity, so agent-workflow's is used.
    expect(await git(dir, 'log', '--format=%an <%ae>|%s')).toBe(
      'agent-workflow <agent-workflow@localhost>|Initial commit',
    );

    const task = await taskInReview(t, res.body.id, { 'src/greet.js': 'hello, world\n' });
    const delivered = await t.call(deliverTaskOp, { id: task.id, strategy: 'squash' });
    expect(delivered.body.status).toBe(TaskStatus.Completed);
    expect(await readFile(join(dir, 'src/greet.js'), 'utf8')).toBe('hello, world\n');
  });

  it('已有的 .gitignore 原样保留，首次提交用用户的 git 身份', async () => {
    const dir = await plainDir({ '.gitignore': 'dist/\n', 'package.json': '{}', 'dist/app.js': 'x' });

    const { body: preview } = await t.call(previewGitInitOp, { repoPath: dir });
    expect(preview).toMatchObject({ files: 2, gitignore: null });

    const config = '[user]\n\tname = Ada\n\temail = ada@example.com\n';
    const res = await withGlobalGitConfig(config, () => t.call(initGitOp, { repoPath: dir, name: '订单' }));
    expect(res.body.name).toBe('订单');
    expect(await readFile(join(dir, '.gitignore'), 'utf8')).toBe('dist/\n');
    expect(await git(dir, 'ls-files')).toBe('.gitignore\npackage.json');
    expect(await git(dir, 'log', '--format=%an <%ae>')).toBe('Ada <ada@example.com>');
  });

  it('所有文件都被忽略时以空的第一个提交初始化', async () => {
    const dir = await plainDir({ '.gitignore': '*\n', 'data.csv': '1,2\n' });
    expect((await t.call(previewGitInitOp, { repoPath: dir })).body).toMatchObject({ files: 0, bytes: 0 });

    expect((await t.call(initGitOp, { repoPath: dir })).status).toBe(201);
    expect(await git(dir, 'ls-files')).toBe('');
    expect(await git(dir, 'log', '--format=%s')).toBe('Initial commit');
  });

  it('同一目录同时初始化两次：一次成功，另一次报已是仓库，不删掉成功的那个', async () => {
    const dir = await plainDir({ 'main.py': 'print(1)\n' });
    const results = await Promise.all([t.call(initGitOp, { repoPath: dir }), t.call(initGitOp, { repoPath: dir })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(results.find((r) => r.status === 400)?.body).toMatchObject({
      error: { code: ErrorCode.ValidationFailed },
    });
    expect(await git(dir, 'log', '--format=%s')).toBe('Initial commit');
    expect((await t.call(listProjectsOp, {})).body.items.map((p) => p.repoPath)).toEqual([dir]);
  });

  it('预览列出过大的文件', async () => {
    const dir = await plainDir({ 'README.md': '# x\n' });
    const video = await open(join(dir, 'demo.mp4'), 'w');
    await video.truncate(GIT_INIT_LARGE_FILE_BYTES);
    await video.close();

    const { body: preview } = await t.call(previewGitInitOp, { repoPath: dir });
    expect(preview).toMatchObject({
      files: 3,
      largeFiles: [{ path: 'demo.mp4', bytes: GIT_INIT_LARGE_FILE_BYTES }],
      largeFileCount: 1,
    });
  });

  it('首次提交失败时目录恢复原样，可以重新添加', async () => {
    const dir = await plainDir({ 'main.py': 'print(1)\n' });
    const hooks = await mkdtemp(join(tmpdir(), 'aw-hooks-'));
    await writeFile(join(hooks, 'pre-commit'), '#!/bin/sh\necho rejected >&2\nexit 1\n');
    await chmod(join(hooks, 'pre-commit'), 0o755);

    const config = `[user]\n\tuseConfigOnly = true\n[core]\n\thooksPath = ${hooks.replaceAll('\\', '/')}\n`;
    const failed = await withGlobalGitConfig(config, () => t.call(initGitOp, { repoPath: dir }));
    expect(failed.body).toMatchObject({ error: { code: ErrorCode.GitCommandFailed } });
    expect(existsSync(join(dir, '.git'))).toBe(false);
    expect(existsSync(join(dir, '.gitignore'))).toBe(false);
    expect((await t.call(createProjectOp, { repoPath: dir })).body).toMatchObject({
      error: { code: ErrorCode.ProjectPathNoGit },
    });

    expect((await t.call(initGitOp, { repoPath: dir })).status).toBe(201);
  });
});
