import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type DeliveryDTO, ErrorCode } from '@aw/shared';
import { expect, it } from 'vitest';
import { createTestRepo } from '../../../test/helpers/git.ts';
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
    state: 'local_pending',
  });
});
