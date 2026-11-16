import { afterEach, beforeEach, expect, it } from 'vitest';
import { createFakeHosting, type FakeHosting } from '../../../test/fakes/fake-hosting.ts';
import { createHostingProvider } from './hosting.provider.ts';

let fake: FakeHosting;
beforeEach(async () => {
  fake = await createFakeHosting({ token: 'token', repos: ['acme/shop'] });
});
afterEach(async () => {
  await fake.close();
});

it.each(['github', 'gitlab'] as const)('%s 读取当前提交的 CI、审查与合并状态', async (platform) => {
  const provider = createHostingProvider(
    { provider: platform, repo: 'acme/shop', baseUrl: null },
    'token',
    fake.endpoints,
  );
  await provider.createPullRequest({ head: 'feature', base: 'main', title: 'test', body: '' });
  const pr = fake.pullRequests[0];
  if (pr === undefined) throw new Error('PR missing');
  pr.status = {
    state: 'open',
    sha: 'b'.repeat(40),
    mergeCommit: null,
    ci: platform === 'github' ? 'PENDING' : 'pending',
    review: platform === 'github' ? 'REVIEW_REQUIRED' : null,
  };
  expect(await provider.getPullRequestStatus(pr.number)).toMatchObject({
    state: 'open',
    head: 'b'.repeat(40),
    targetBranch: 'main',
    ci: pr.status.ci,
  });
  pr.status = {
    state: 'merged',
    sha: 'c'.repeat(40),
    mergeCommit: 'd'.repeat(40),
    ci: platform === 'github' ? 'SUCCESS' : 'success',
    review: platform === 'github' ? 'APPROVED' : 'approved',
  };
  expect(await provider.getPullRequestStatus(pr.number)).toEqual({
    state: 'merged',
    head: 'c'.repeat(40),
    targetBranch: 'main',
    mergeCommit: 'd'.repeat(40),
    ci: pr.status.ci,
    review: pr.status.review,
  });
});

it.each(['github', 'gitlab'] as const)('%s 拒绝没有仓库权限的状态查询', async (platform) => {
  const provider = createHostingProvider(
    { provider: platform, repo: 'acme/shop', baseUrl: null },
    'wrong',
    fake.endpoints,
  );
  await expect(provider.getPullRequestStatus(1)).rejects.toMatchObject({ code: 'HOSTING_AUTH_FAILED' });
});
