import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectOp, deleteProjectOp, ErrorCode, getProjectOp, listProjectsOp, updateProjectOp } from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';

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

  it('未给名称时用目录名，同名 slug 自动加序号', async () => {
    const a = await t.call(createProjectOp, { repoPath: (await createTestRepo()).path, name: 'app' });
    const b = await t.call(createProjectOp, { repoPath: (await createTestRepo()).path, name: 'App' });
    const c = await t.call(createProjectOp, { repoPath: (await createTestRepo()).path });
    expect([a.body.slug, b.body.slug]).toEqual(['app', 'app-2']);
    expect(c.body.name).toMatch(/^aw-repo-/);
  });

  it('非 Git 仓库目录返回 400 PROJECT_PATH_NOT_GIT_REPO', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aw-plain-'));
    const res = await t.call(createProjectOp, { repoPath: dir });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: ErrorCode.ProjectPathNotGitRepo } });
  });

  it('仓库子目录与不存在的路径同样返回 400 PROJECT_PATH_NOT_GIT_REPO', async () => {
    const repo = await createTestRepo();
    await mkdir(join(repo.path, 'src'));
    for (const repoPath of [join(repo.path, 'src'), join(repo.path, 'missing')]) {
      const res = await t.call(createProjectOp, { repoPath });
      expect(res.body).toMatchObject({ error: { code: ErrorCode.ProjectPathNotGitRepo } });
    }
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
