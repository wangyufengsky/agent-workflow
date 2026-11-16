import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  confirmInitiativeOp,
  createInitiativeOp,
  createProjectOp,
  deliverTaskOp,
  getInitiativeOp,
  initiativeCoverageTraceOp,
  initiativeMergeReadinessOp,
  refreshDeliveryStatusOp,
  saveInitiativeDraftOp,
  setProjectHostingOp,
  updateProjectOp,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { createFakeHosting } from '../../../test/fakes/fake-hosting.ts';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp } from '../../../test/helpers/app.ts';
import { testCipher } from '../../../test/helpers/cipher.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';
import { taskReaches } from '../../../test/helpers/tasks.ts';
import { runGit } from '../git/index.ts';

it('远端 squash 已合入、本地更新后仍须用户确认才能解锁下一阶段', async () => {
  const hosting = await createFakeHosting({ token: 'token', repos: ['acme/shop'], canonicalWebUrls: true });
  const t = await createTestApp({ cipher: testCipher, hosting: hosting.endpoints });
  try {
    const origin = await mkdtemp(join(tmpdir(), 'aw-origin-'));
    await runGit(['init', '-q', '--bare', origin], { cwd: origin });
    const repo = await createTestRepo({ origin, files: { 'a/a.ts': 'export const a = 1;\n' } });
    await repo.git('push', '-q', '-u', 'origin', 'main');
    const { body: project } = await t.call(createProjectOp, { repoPath: repo.path });
    await t.call(updateProjectOp, { id: project.id, checkCommand: null });
    await t.call(setProjectHostingOp, { id: project.id, provider: 'github', repo: 'acme/shop', token: 'token' });
    const { body: initiative } = await t.call(createInitiativeOp, {
      projectId: project.id,
      templateKey: 'tests_then_refactor',
      requirement: '测试',
      review: true,
    });
    await t.call(saveInitiativeDraftOp, {
      id: initiative.id,
      phases: [{ title: '一' }, { title: '二' }],
      items: [
        { key: 'a', title: '测试 a', phase: 1, workflow: 'unit_tests', requirement: '测试 a', dependsOn: [] },
        { key: 'b', title: '测试 b', phase: 2, workflow: 'unit_tests', requirement: '测试 b', dependsOn: ['a'] },
      ],
    });
    t.fake.enqueue(script().callTool('submit_result', { summary: 'Gaps' }), { title: 'T-1 · 分析测试缺口' });
    t.fake.enqueue(script().edit('a/a.test.ts', '// test\n').callTool('submit_result', { summary: 'Tested' }), {
      title: 'T-1 · 编写测试',
    });
    t.fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: 'Good' }), {
      agent: 'aw-reviewer',
      title: 'T-1 · ',
    });
    const done = taskReaches(t, 'review');
    const confirmed = await t.call(confirmInitiativeOp, { id: initiative.id });
    await done;
    const taskId = confirmed.body.items[0]?.task?.id;
    if (taskId === undefined) throw new Error('task missing');
    const delivered = await t.call(deliverTaskOp, { id: taskId, strategy: 'pull_request' });
    await t.call(refreshDeliveryStatusOp, { id: taskId });
    const openTrace = (await t.call(initiativeCoverageTraceOp, { id: initiative.id })).body.items[0]?.tasks[0];
    expect(openTrace?.delivery).toMatchObject({ strategy: 'pull_request', remoteStatus: { state: 'open' } });
    expect((await t.call(getInitiativeOp, { id: initiative.id })).body.items[0]?.status).toBe('pr_open');
    const head = delivered.body.lastDelivery?.diffHead;
    const branch = delivered.body.git.branch;
    if (head === null || head === undefined || branch === null) throw new Error('delivery evidence missing');
    await repo.git('checkout', '-qb', 'remote-main');
    await repo.git('merge', '--squash', branch);
    await repo.git('commit', '-qm', 'squash');
    const mergeCommit = (await repo.git('rev-parse', 'HEAD')).trim();
    await repo.git('checkout', '-q', 'main');
    const pr = hosting.pullRequests[0];
    if (pr === undefined) throw new Error('PR missing');
    pr.status = { state: 'merged', sha: head, mergeCommit, ci: 'SUCCESS', review: 'APPROVED' };
    await t.call(refreshDeliveryStatusOp, { id: taskId });
    expect((await t.call(initiativeMergeReadinessOp, { id: initiative.id, key: 'a' })).body.state).toBe(
      'local_pending',
    );
    await repo.git('merge', '--ff-only', 'remote-main');
    expect((await t.call(initiativeMergeReadinessOp, { id: initiative.id, key: 'a' })).body.state).toBe('ready');
    await t.app.services.initiatives.settled();
    const after = (await t.call(getInitiativeOp, { id: initiative.id })).body;
    expect(after.items.map((item) => [item.key, item.status, item.task?.id ?? null])).toEqual([
      ['a', 'pr_open', taskId],
      ['b', 'phase_closed', null],
    ]);
  } finally {
    await t.close();
    await hosting.close();
  }
});
