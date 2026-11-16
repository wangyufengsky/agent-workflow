import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectOp, deliverTaskOp, getTaskOp, refreshDeliveryStatusOp, setProjectHostingOp } from '@aw/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createFakeHosting, type FakeHosting } from '../../../test/fakes/fake-hosting.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { testCipher } from '../../../test/helpers/cipher.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';
import { taskInReview } from '../../../test/helpers/tasks.ts';
import { runGit } from '../git/index.ts';

let fake: FakeHosting;
let t: TestApp;
beforeEach(async () => {
  fake = await createFakeHosting({ token: 'token', repos: ['acme/shop', 'other/repo'], canonicalWebUrls: true });
  t = await createTestApp({ cipher: testCipher, hosting: fake.endpoints });
});
afterEach(async () => {
  await t.close();
  await fake.close();
});

it('刷新远端提交状态，查询失败后保留上次快照', async () => {
  const origin = await mkdtemp(join(tmpdir(), 'aw-origin-'));
  await runGit(['init', '-q', '--bare', origin], { cwd: origin });
  const repo = await createTestRepo({ origin });
  await repo.git('push', '-q', '-u', 'origin', 'main');
  const { body: project } = await t.call(createProjectOp, { repoPath: repo.path });
  await t.call(setProjectHostingOp, { id: project.id, provider: 'github', repo: 'acme/shop', token: 'token' });
  const task = await taskInReview(t, project.id, { 'fix.txt': 'fixed\n' });
  await t.call(deliverTaskOp, { id: task.id, strategy: 'pull_request' });
  const pr = fake.pullRequests[0];
  if (pr === undefined) throw new Error('PR missing');
  pr.status = { state: 'open', sha: 'b'.repeat(40), mergeCommit: null, ci: 'PENDING', review: 'REVIEW_REQUIRED' };
  const first = await t.call(refreshDeliveryStatusOp, { id: task.id });
  expect(first.body.lastDelivery?.remoteStatus).toMatchObject({
    state: 'open',
    head: 'b'.repeat(40),
    ci: 'PENDING',
    review: 'REVIEW_REQUIRED',
  });
  const gate = fake.pauseNextStatus();
  const older = t.app.services.tasks.refreshDeliveryStatus(task.id);
  await gate.started;
  pr.status = { state: 'open', sha: 'e'.repeat(40), mergeCommit: null, ci: 'FAILURE', review: 'CHANGES_REQUESTED' };
  const concurrent = t.app.services.tasks.refreshDeliveryStatus(task.id);
  gate.release();
  const [one, two] = await Promise.all([older, concurrent]);
  expect(one.lastDelivery?.remoteStatus?.head).toBe('b'.repeat(40));
  expect(two.lastDelivery?.remoteStatus?.head).toBe('b'.repeat(40));
  const newer = await t.call(refreshDeliveryStatusOp, { id: task.id });
  expect(newer.body.lastDelivery?.remoteStatus?.head).toBe('e'.repeat(40));
  pr.status = { state: 'merged', sha: 'c'.repeat(40), mergeCommit: 'd'.repeat(40), ci: 'SUCCESS', review: 'APPROVED' };
  const merged = await t.call(refreshDeliveryStatusOp, { id: task.id });
  expect(merged.body.lastDelivery?.remoteStatus).toMatchObject({
    state: 'merged',
    head: 'c'.repeat(40),
    mergeCommit: 'd'.repeat(40),
  });
  expect(merged.body.lastDelivery?.remoteRef).toEqual({ provider: 'github', baseUrl: null, repo: 'acme/shop' });
  await t.call(setProjectHostingOp, { id: project.id, provider: 'github', repo: 'other/repo', token: 'token' });
  const changed = await t.call(refreshDeliveryStatusOp, { id: task.id });
  expect(changed.body.lastDelivery?.remoteError?.code).toBe('HOSTING_NOT_CONFIGURED');
  expect(changed.body.lastDelivery?.remoteStatus).toEqual(merged.body.lastDelivery?.remoteStatus);
  await t.call(setProjectHostingOp, { id: project.id, provider: 'github', repo: 'acme/shop', token: 'token' });
  await t.call(setProjectHostingOp, { id: project.id, provider: 'github', repo: 'acme/shop', token: 'wrong' });
  // A binding change is validated before saving, so reject access by removing the PR from the platform.
  fake.pullRequests.splice(0, 1);
  const failed = await t.call(refreshDeliveryStatusOp, { id: task.id });
  expect(failed.body.lastDelivery?.remoteError?.code).toBe('HOSTING_API_ERROR');
  expect(failed.body.lastDelivery?.remoteStatus).toEqual(merged.body.lastDelivery?.remoteStatus);
  expect((await t.call(getTaskOp, { id: task.id })).body.lastDelivery?.remoteStatus).toEqual(
    merged.body.lastDelivery?.remoteStatus,
  );
});
