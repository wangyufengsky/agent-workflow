import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearProjectHostingOp,
  createProjectOp,
  deleteProjectOp,
  deliverTaskOp,
  ErrorCode,
  getProjectOp,
  setProjectHostingOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeHosting, type FakeHosting } from '../../../test/fakes/fake-hosting.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { testCipher } from '../../../test/helpers/cipher.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';
import { taskInReview } from '../../../test/helpers/tasks.ts';
import { runGit } from '../git/index.ts';

const TOKEN = 'ghp_valid';
let hosting: FakeHosting;
let t: TestApp;
beforeEach(async () => {
  hosting = await createFakeHosting({ token: TOKEN, repos: ['acme/shop', 'group/sub/shop'] });
  t = await createTestApp({ cipher: testCipher, hosting: hosting.endpoints });
});
afterEach(async () => {
  await t.close();
  await hosting.close();
});

/** A project whose origin is a local bare repository, so pushes really happen. */
async function projectWithOrigin() {
  const origin = await mkdtemp(join(tmpdir(), 'aw-origin-'));
  await runGit(['init', '-q', '--bare', origin], { cwd: origin });
  const repo = await createTestRepo({ origin });
  await repo.git('push', '-q', '-u', 'origin', 'main');
  const { body: project } = await t.call(createProjectOp, { repoPath: repo.path });
  return { repo, origin, project };
}

describe('远端绑定（11 §3）', () => {
  it('GitHub：令牌被平台拒绝时不保存；验证通过后保存，只暴露是否有令牌；解除绑定', async () => {
    const { project } = await projectWithOrigin();
    const rejected = await t.call(setProjectHostingOp, {
      id: project.id,
      provider: 'github',
      repo: 'acme/shop',
      token: 'wrong',
    });
    expect([rejected.status, rejected.raw.json().error.code]).toEqual([401, ErrorCode.HostingAuthFailed]);
    expect((await t.call(getProjectOp, { id: project.id })).body.hosting).toBeNull();

    const bound = await t.call(setProjectHostingOp, {
      id: project.id,
      provider: 'github',
      repo: 'acme/shop',
      token: TOKEN,
    });
    expect(bound.body.hosting).toEqual({ provider: 'github', baseUrl: null, repo: 'acme/shop', hasToken: true });
    expect(bound.raw.body).not.toContain(TOKEN);

    const cleared = await t.call(clearProjectHostingOp, { id: project.id });
    expect(cleared.body.hosting).toBeNull();
  });

  it('自建 GitLab：按 baseUrl 访问；没有权限的仓库算作令牌无效', async () => {
    const { project } = await projectWithOrigin();
    const baseUrl = `${hosting.endpoints.gitlabUrl}/`;
    const denied = await t.call(setProjectHostingOp, {
      id: project.id,
      provider: 'gitlab',
      baseUrl,
      repo: 'other/repo',
      token: TOKEN,
    });
    expect(denied.raw.json().error.code).toBe(ErrorCode.HostingAuthFailed);
    const { body } = await t.call(setProjectHostingOp, {
      id: project.id,
      provider: 'gitlab',
      baseUrl,
      repo: 'group/sub/shop',
      token: TOKEN,
    });
    expect(body.hosting).toEqual({
      provider: 'gitlab',
      baseUrl: hosting.endpoints.gitlabUrl,
      repo: 'group/sub/shop',
      hasToken: true,
    });
    expect((await t.call(deleteProjectOp, { id: project.id })).status).toBe(204);
  });
});

describe('交付：创建 PR（11 §5.3）', () => {
  it('推送任务分支并创建 PR：任务完成，记录 PR 地址，保留分支，删除 worktree', async () => {
    const { origin, project } = await projectWithOrigin();
    await t.call(setProjectHostingOp, { id: project.id, provider: 'github', repo: 'acme/shop', token: TOKEN });
    const task = await taskInReview(t, project.id, { 'fix.txt': 'fixed\n' });

    const { body } = await t.call(deliverTaskOp, { id: task.id, strategy: 'pull_request' });

    expect(body).toMatchObject({
      status: 'completed',
      lastDelivery: { strategy: 'pull_request', status: 'succeeded', prUrl: 'https://github.example/acme/shop/pull/1' },
      git: { worktreeStatus: 'removed' },
    });
    expect(hosting.pullRequests).toEqual([
      {
        provider: 'github',
        repo: 'acme/shop',
        head: task.git.branch,
        base: 'main',
        title: task.title,
        body: task.result?.summary,
      },
    ]);
    const remote = await runGit(['rev-parse', `refs/heads/${task.git.branch}`], { cwd: origin });
    expect(remote.stdout).toMatch(/^[0-9a-f]{40}$/);
  });

  it('GitLab 创建 MR，可指定标题与说明；平台报错时交付失败，任务回到待合并', async () => {
    const { project } = await projectWithOrigin();
    await t.call(setProjectHostingOp, {
      id: project.id,
      provider: 'gitlab',
      baseUrl: hosting.endpoints.gitlabUrl,
      repo: 'group/sub/shop',
      token: TOKEN,
    });
    const task = await taskInReview(t, project.id, { 'fix.txt': 'fixed\n' });
    const pr = { title: 'Fix greeting', body: 'Details' };
    hosting.failNextPullRequest(409, 'Another open merge request already exists');

    const failed = await t.call(deliverTaskOp, { id: task.id, strategy: 'pull_request', pr });
    expect(failed.body).toMatchObject({
      status: 'review',
      lastDelivery: { status: 'failed', error: { code: ErrorCode.HostingApiError, details: { status: 409 } } },
    });

    const { body } = await t.call(deliverTaskOp, { id: task.id, strategy: 'pull_request', pr });
    expect(body.lastDelivery?.prUrl).toBe('https://gitlab.example/group/sub/shop/-/merge_requests/1');
    expect(hosting.pullRequests.map((p) => [p.provider, p.title, p.body])).toEqual([['gitlab', pr.title, pr.body]]);
  });

  it('项目未绑定远端：400 HOSTING_NOT_CONFIGURED，任务保持待合并', async () => {
    const { project } = await projectWithOrigin();
    const task = await taskInReview(t, project.id, { 'fix.txt': 'fixed\n' });
    const res = await t.call(deliverTaskOp, { id: task.id, strategy: 'pull_request' });
    expect([res.status, res.raw.json().error.code]).toEqual([400, ErrorCode.HostingNotConfigured]);
  });
});
