import {
  createProjectOp,
  ErrorCode,
  getProjectOp,
  gitCreatePullRequestOp,
  listHostingAccountsOp,
  removeHostingAccountOp,
  setHostingAccountOp,
  setProjectHostingOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeHosting, FAKE_USER, type FakeHosting } from '../../../test/fakes/fake-hosting.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { testCipher } from '../../../test/helpers/cipher.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';

const TOKEN = 'ghp_valid';
let hosting: FakeHosting;
let t: TestApp;
beforeEach(async () => {
  hosting = await createFakeHosting({ token: TOKEN, repos: ['acme/shop', 'acme/own'] });
  t = await createTestApp({ cipher: testCipher, hosting: hosting.endpoints });
});
afterEach(async () => {
  await t.close();
  await hosting.close();
});

describe('全局 GitHub / GitLab 令牌（D155）', () => {
  it('平台拒绝的令牌不保存；保存后只暴露账号；同一地址再次保存是替换；删除', async () => {
    const rejected = await t.call(setHostingAccountOp, { provider: 'github', token: 'wrong' });
    expect([rejected.status, rejected.raw.json().error.code]).toEqual([401, ErrorCode.HostingAuthFailed]);

    const github = await t.call(setHostingAccountOp, { provider: 'github', token: TOKEN });
    expect(github.body).toMatchObject({ provider: 'github', baseUrl: null, account: FAKE_USER });
    expect(github.raw.body).not.toContain(TOKEN);
    const gitlab = await t.call(setHostingAccountOp, {
      provider: 'gitlab',
      baseUrl: `${hosting.endpoints.gitlabUrl}/`,
      token: TOKEN,
    });
    expect(gitlab.body.baseUrl).toBe(hosting.endpoints.gitlabUrl);
    const again = await t.call(setHostingAccountOp, { provider: 'github', token: TOKEN });
    expect(again.body.id).toBe(github.body.id);

    const listed = await t.call(listHostingAccountsOp, {});
    expect(listed.body.items.map((a) => a.provider)).toEqual(['github', 'gitlab']);
    expect(listed.raw.body).not.toContain(TOKEN);

    await t.call(removeHostingAccountOp, { id: github.body.id });
    expect((await t.call(listHostingAccountsOp, {})).body.items.map((a) => a.id)).toEqual([gitlab.body.id]);
  });

  it('项目没有自己的令牌时，按 origin 的平台使用全局令牌创建 PR；项目绑定的令牌优先', async () => {
    const repo = await createTestRepo({ origin: 'https://github.com/acme/shop.git' });
    await repo.git('switch', '-q', '-c', 'feature');
    const { body: project } = await t.call(createProjectOp, { repoPath: repo.path });
    expect(project.effectiveHosting).toBeNull();
    const pr = { id: project.id, branch: 'feature', base: 'main', title: '加一个功能' };
    const unconfigured = await t.call(gitCreatePullRequestOp, pr);
    expect(unconfigured.raw.json().error.code).toBe(ErrorCode.HostingNotConfigured);

    const { body: account } = await t.call(setHostingAccountOp, { provider: 'github', token: TOKEN });
    expect((await t.call(getProjectOp, { id: project.id })).body.effectiveHosting).toEqual({
      provider: 'github',
      baseUrl: null,
      repo: 'acme/shop',
      source: 'global',
    });
    expect((await t.call(gitCreatePullRequestOp, pr)).status).toBe(201);
    expect(hosting.pullRequests.map((p) => [p.repo, p.head])).toEqual([['acme/shop', 'feature']]);

    await t.call(setProjectHostingOp, { id: project.id, provider: 'github', repo: 'acme/own', token: TOKEN });
    await t.call(removeHostingAccountOp, { id: account.id });
    expect((await t.call(getProjectOp, { id: project.id })).body.effectiveHosting).toMatchObject({
      repo: 'acme/own',
      source: 'project',
    });
  });

  it('SSH origin 按主机名匹配已保存的自建 GitLab 地址（HTTP、非标准端口），创建 MR 用上它的令牌（D169）', async () => {
    // The fake's GitLab is http://127.0.0.1:<port>/gitlab, like an intranet GitLab whose web port is not SSH's.
    const gitlabUrl = hosting.endpoints.gitlabUrl;
    const repo = await createTestRepo({ origin: `git@${new URL(gitlabUrl).hostname}:acme/shop.git` });
    await repo.git('switch', '-q', '-c', 'feature');
    const { body: project } = await t.call(createProjectOp, { repoPath: repo.path });
    await t.call(setHostingAccountOp, { provider: 'gitlab', baseUrl: gitlabUrl, token: TOKEN });

    expect((await t.call(getProjectOp, { id: project.id })).body.effectiveHosting).toEqual({
      provider: 'gitlab',
      baseUrl: gitlabUrl,
      repo: 'acme/shop',
      source: 'global',
    });
    const pr = { id: project.id, branch: 'feature', base: 'main', title: '加一个功能' };
    expect((await t.call(gitCreatePullRequestOp, pr)).status).toBe(201);
    expect(hosting.pullRequests.map((p) => [p.provider, p.repo, p.head])).toEqual([['gitlab', 'acme/shop', 'feature']]);
  });
});
