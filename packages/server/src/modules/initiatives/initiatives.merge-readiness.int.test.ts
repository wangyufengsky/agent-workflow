import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type DeliveryDTO, ErrorCode } from '@aw/shared';
import { expect, it } from 'vitest';
import { createFakeHosting } from '../../../test/fakes/fake-hosting.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';
import { createHostingProvider } from '../hosting/index.ts';
import { checkMergeReadiness } from './initiatives.merge-readiness.ts';

it('平台 squash 合入后，只有本地基础分支包含真实合入提交才可以确认', async () => {
  const repo = await createTestRepo();
  await repo.git('checkout', '-qb', 'feature');
  await writeFile(join(repo.path, 'change.txt'), 'change');
  await repo.git('add', 'change.txt');
  await repo.git('commit', '-qm', 'feature');
  const head = (await repo.git('rev-parse', 'HEAD')).trim();
  await repo.git('checkout', '-q', 'main');
  await repo.git('checkout', '-qb', 'remote-main');
  await repo.git('merge', '--squash', 'feature');
  await repo.git('commit', '-qm', 'squash');
  const mergeCommit = (await repo.git('rev-parse', 'HEAD')).trim();
  await repo.git('checkout', '-q', 'main');
  const delivery: DeliveryDTO = {
    id: 'd',
    strategy: 'pull_request',
    targetBranch: 'main',
    status: 'succeeded',
    commitSha: null,
    prUrl: 'https://github.com/acme/shop/pull/1',
    diffBase: null,
    diffHead: head,
    remoteRef: null,
    conflictFiles: null,
    error: null,
    createdAt: 1,
    finishedAt: 2,
    remoteError: null,
    remoteStatus: {
      state: 'merged',
      head,
      targetBranch: 'main',
      mergeCommit,
      ci: 'SUCCESS',
      review: 'APPROVED',
      checkedAt: 3,
    },
  };
  expect(await checkMergeReadiness(repo.path, 'main', delivery)).toEqual({ state: 'local_pending' });
  if (delivery.remoteStatus === null) throw new Error('status missing');
  const absent = { ...delivery, remoteStatus: { ...delivery.remoteStatus, mergeCommit: 'f'.repeat(40) } };
  expect(await checkMergeReadiness(repo.path, 'main', absent)).toEqual({ state: 'local_pending' });
  const invalidBranch = { ...delivery, remoteStatus: { ...delivery.remoteStatus, targetBranch: 'missing' } };
  await expect(checkMergeReadiness(repo.path, 'missing', invalidBranch)).rejects.toMatchObject({
    code: ErrorCode.GitCommandFailed,
  });
  await repo.git('merge', '--ff-only', 'remote-main');
  expect(await checkMergeReadiness(repo.path, 'main', delivery)).toEqual({ state: 'ready' });
  expect(await checkMergeReadiness(repo.path, 'main', { ...delivery, diffHead: 'f'.repeat(40) })).toEqual({
    state: 'unverified',
  });
});

it('GitLab 无合入 SHA 时仅以本地祖先证明原 head 已合入；旧交付和变基证据不足', async () => {
  const fake = await createFakeHosting({ token: 'token', repos: ['team/project'] });
  try {
    const provider = createHostingProvider(
      { provider: 'gitlab', repo: 'team/project', baseUrl: null },
      'token',
      fake.endpoints,
    );
    await provider.createPullRequest({ head: 'feature', base: 'main', title: 'test', body: '' });
    const pr = fake.pullRequests[0];
    if (pr === undefined) throw new Error('PR missing');
    const repo = await createTestRepo();
    await repo.git('checkout', '-qb', 'feature');
    await writeFile(join(repo.path, 'change.txt'), 'feature');
    await repo.git('add', 'change.txt');
    await repo.git('commit', '-qm', 'feature');
    const head = (await repo.git('rev-parse', 'HEAD')).trim();
    await repo.git('checkout', '-q', 'main');
    pr.status = { state: 'merged', sha: head, mergeCommit: null, ci: 'success', review: 'approved' };
    const platform = await provider.getPullRequestStatus(pr.number);
    expect(platform).toMatchObject({ state: 'merged', head, mergeCommit: null });
    const delivery: DeliveryDTO = {
      id: 'd',
      strategy: 'pull_request',
      targetBranch: 'main',
      status: 'succeeded',
      commitSha: null,
      prUrl: 'https://gitlab.com/team/project/-/merge_requests/1',
      diffBase: null,
      diffHead: head,
      remoteRef: { provider: 'gitlab', repo: 'team/project', baseUrl: null },
      conflictFiles: null,
      error: null,
      createdAt: 1,
      finishedAt: 2,
      remoteError: null,
      remoteStatus: { ...platform, checkedAt: 3 },
    };
    expect(await checkMergeReadiness(repo.path, 'main', delivery)).toEqual({ state: 'unverified' });
    await repo.git('merge', '--ff-only', 'feature');
    expect(await checkMergeReadiness(repo.path, 'main', delivery)).toEqual({ state: 'ready' });
    const rebased = await createTestRepo();
    await rebased.git('checkout', '-qb', 'feature');
    await writeFile(join(rebased.path, 'feature.txt'), 'change');
    await rebased.git('add', 'feature.txt');
    await rebased.git('commit', '-qm', 'feature');
    const original = (await rebased.git('rev-parse', 'HEAD')).trim();
    await rebased.git('checkout', '-q', 'main');
    await writeFile(join(rebased.path, 'base.txt'), 'new base');
    await rebased.git('add', 'base.txt');
    await rebased.git('commit', '-qm', 'base');
    await rebased.git('cherry-pick', original);
    const replayed = { ...delivery, diffHead: original, remoteStatus: { ...platform, head: original, checkedAt: 3 } };
    expect(await checkMergeReadiness(rebased.path, 'main', replayed)).toEqual({ state: 'unverified' });
    expect(await checkMergeReadiness(repo.path, 'main', { ...delivery, diffHead: null, remoteRef: null })).toEqual({
      state: 'unverified',
    });
    expect(await checkMergeReadiness(repo.path, 'main', { ...delivery, diffHead: 'f'.repeat(40) })).toEqual({
      state: 'unverified',
    });
    expect(
      await checkMergeReadiness(repo.path, 'main', {
        ...delivery,
        remoteError: { code: ErrorCode.HostingUnreachable, message: 'offline' },
      }),
    ).toEqual({ state: 'refresh_failed' });
  } finally {
    await fake.close();
  }
});
