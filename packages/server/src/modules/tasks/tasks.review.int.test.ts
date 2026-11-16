import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  archiveTaskOp,
  createProjectOp,
  createTaskOp,
  deliverTaskOp,
  ErrorCode,
  getTaskOp,
  getTaskTimelineOp,
  NodeEvent,
  previewConventionEvidenceOp,
  ReviewCommentKind,
  reviewCommentsOp,
  reviseFromReviewOp,
  ServerEventType,
  setProjectHostingOp,
  startAgentsMdTaskOp,
  taskDiffFileOp,
  taskDiffOp,
  updateSettingsOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeHosting, type FakeHosting } from '../../../test/fakes/fake-hosting.ts';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { testCipher } from '../../../test/helpers/cipher.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';
import { addProject, createTask, taskInReview, taskReaches, workflowId } from '../../../test/helpers/tasks.ts';
import { runGit } from '../git/index.ts';

const TOKEN = 'ghp_valid';
const REVIEWER = ['-c', 'user.name=Reviewer', '-c', 'user.email=reviewer@example.com'];
let hosting: FakeHosting;
let t: TestApp;
beforeEach(async () => {
  hosting = await createFakeHosting({ token: TOKEN, repos: ['acme/shop', 'group/shop'] });
  t = await createTestApp({ cipher: testCipher, hosting: hosting.endpoints });
});
afterEach(async () => {
  await t.close();
  await hosting.close();
});

/** A task delivered as a pull request on a project whose origin is a local bare repository. */
async function deliveredAsPullRequest(binding: { provider: 'github' | 'gitlab'; repo: string }) {
  const origin = await mkdtemp(join(tmpdir(), 'aw-origin-'));
  await runGit(['init', '-q', '--bare', origin], { cwd: origin });
  const repo = await createTestRepo({ origin, files: { 'greet.ts': 'export const greet = "hi";\n' } });
  await repo.git('push', '-q', '-u', 'origin', 'main');
  const { body: project } = await t.call(createProjectOp, { repoPath: repo.path });
  await t.call(setProjectHostingOp, {
    id: project.id,
    ...binding,
    ...(binding.provider === 'gitlab' ? { baseUrl: hosting.endpoints.gitlabUrl } : {}),
    token: TOKEN,
  });
  const task = await taskInReview(t, project.id, { 'greet.ts': 'export const greet = "hello";\n' });
  const { body: delivered } = await t.call(deliverTaskOp, { id: task.id, strategy: 'pull_request' });
  const branch = task.git.branch ?? '';
  return { origin, repo, task: delivered, branch, worktree: task.git.worktreePath ?? '' };
}

/** A reviewer commits a suggestion straight onto the pull request's branch. */
async function reviewerCommits(origin: string, branch: string, file: string, content: string): Promise<string> {
  const clone = await mkdtemp(join(tmpdir(), 'aw-reviewer-'));
  await runGit(['clone', '-q', '--branch', branch, origin, clone], { cwd: clone });
  await writeFile(join(clone, file), content);
  await runGit([...REVIEWER, 'commit', '-q', '-am', 'Apply suggestion'], { cwd: clone });
  await runGit(['push', '-q', 'origin', branch], { cwd: clone });
  return (await runGit(['rev-parse', 'HEAD'], { cwd: clone })).stdout.trim();
}

describe('PR 审查意见回流（21）', () => {
  it('项目约定只接受同项目的失败和审查意见，并将预览内容作为不可变任务资料', async () => {
    const { task, branch } = await deliveredAsPullRequest({ provider: 'github', repo: 'acme/shop' });
    hosting.addComment(branch, { author: 'reviewer', body: '数据库变更需要迁移测试 token=secretvalue' });
    const comments = (await t.call(reviewCommentsOp, { id: task.id })).body.items;
    const comment = comments[0];
    if (comment === undefined) throw new Error('Missing comment');
    await t.call(updateSettingsOp, { 'node.maxAttempts': 1 });
    const failures = [];
    const attemptIds: string[] = [];
    for (const label of ['第一条失败', '第二条失败']) {
      t.fake.enqueue(script().error('APIError', label), { title: '· 定位根因' });
      const failed = taskReaches(t, 'failed');
      const source = await createTask(t, { projectId: task.project.id, workflow: 'bugfix', requirement: label });
      await failed;
      const timeline = (await t.call(getTaskTimelineOp, { id: source.id })).body.items;
      const event = timeline.find((e) => e.type === NodeEvent.AttemptFailed);
      if (event === undefined) throw new Error('Missing failure event');
      const failedAttempt = timeline.find((e) => e.entity === 'attempt' && e.toStatus === 'failed');
      if (failedAttempt === undefined) throw new Error('Missing failed attempt');
      attemptIds.push(failedAttempt.entityId);
      failures.push({ taskId: source.id, eventId: event.id });
    }
    const request = { id: task.project.id, failures, reviews: [{ taskId: task.id, commentId: comment.id }] };
    const { body: preview } = await t.call(previewConventionEvidenceOp, request);
    expect(preview.text).toContain('第一条失败');
    expect(preview.text).toContain('第二条失败');
    expect(preview.text).toContain('数据库变更需要迁移测试');
    expect(preview.text).not.toContain('secretvalue');
    expect(preview.suggestions.map((s) => s.text).join()).not.toContain('secretvalue');
    expect(preview.suggestions).toHaveLength(3);
    expect(preview.suggestions.slice(0, 2).map((s) => s.attemptId)).toEqual(attemptIds);
    const { project: other } = await addProject(t);
    expect((await t.call(previewConventionEvidenceOp, { ...request, id: other.id })).status).toBe(400);
    expect(
      (
        await t.call(startAgentsMdTaskOp, {
          id: other.id,
          includeRules: false,
          evidenceAttachmentId: preview.attachmentId,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await t.call(previewConventionEvidenceOp, {
          ...request,
          failures: [{ taskId: task.id, eventId: failures[0]?.eventId ?? 0 }],
        })
      ).status,
    ).toBe(400);
    const workflow = await workflowId(t, 'bugfix');
    const bypass = await t.call(createTaskOp, {
      projectId: other.id,
      workflowId: workflow,
      requirement: '跨项目资料',
      start: false,
      attachmentIds: [preview.attachmentId],
    });
    expect(bypass.status).toBe(400);
    expect(bypass.body).toMatchObject({ error: { code: ErrorCode.AttachmentSourceInvalid } });
    const sameProject = await t.call(createTaskOp, {
      projectId: task.project.id,
      workflowId: workflow,
      requirement: '本项目资料',
      start: false,
      attachmentIds: [preview.attachmentId],
    });
    expect(sameProject.status).toBe(201);
    hosting.addComment(branch, { author: 'reviewer', body: '后续新评论' });
    const { body: created } = await t.call(startAgentsMdTaskOp, {
      id: task.project.id,
      includeRules: false,
      evidenceAttachmentId: preview.attachmentId,
      guidance: '迁移必须有测试',
    });
    expect(created.attachments.map((a) => a.id)).toContain(preview.attachmentId);
    const content = await t.request({ method: 'GET', url: `/attachments/${preview.attachmentId}/content` });
    expect(content.body).toContain('数据库变更需要迁移测试');
    expect(content.body).not.toContain('后续新评论');
  });

  it('PR 推送后和目标分支继续前进后，历史 diff 保留推送时的范围', async () => {
    const { repo, task, branch } = await deliveredAsPullRequest({ provider: 'github', repo: 'acme/shop' });
    const base = (await repo.git('rev-parse', 'main')).trim();
    const head = (await repo.git('rev-parse', branch)).trim();
    expect(task.lastDelivery).toMatchObject({ diffBase: base, diffHead: head });
    await writeFile(join(repo.path, 'later.txt'), 'later\n');
    await repo.git('add', '-A');
    await repo.git('commit', '-qm', 'later');
    const diff = await t.call(taskDiffOp, { id: task.id });
    expect(diff.body).toMatchObject({ base, files: [{ path: 'greet.ts' }] });
  });

  it('取回意见 → 勾选 → AI 在重建的工作区按意见修改（含审查者提交的建议）→ 推送到同一个 PR', async () => {
    const { origin, task, branch, worktree } = await deliveredAsPullRequest({ provider: 'github', repo: 'acme/shop' });
    expect(task).toMatchObject({ status: 'completed', git: { worktreeStatus: 'removed' } });
    expect(task.pullRequest?.url).toBe('https://github.example/acme/shop/pull/1');
    hosting.addReviewThread(branch, {
      path: 'greet.ts',
      line: 1,
      messages: [
        { author: 'alice', body: 'Handle an empty name here.' },
        { author: 'bob', body: 'Agreed.' },
      ],
    });
    hosting.addReviewThread(branch, {
      path: 'greet.ts',
      line: 1,
      resolved: true,
      messages: [{ author: 'alice', body: 'Done' }],
    });
    hosting.addComment(branch, { author: 'ci-bot', body: 'Coverage 85%', createdAt: '2020-01-01T00:00:00Z' });
    hosting.addComment(branch, { author: 'alice', body: 'Please add a test.' });
    const suggestion = 'export const greet = "hello!";\n';
    const suggested = await reviewerCommits(origin, branch, 'greet.ts', suggestion);

    const { body: comments } = await t.call(reviewCommentsOp, { id: task.id });
    expect(comments.pullRequest).toEqual({ number: 1, url: 'https://github.example/acme/shop/pull/1' });
    // The resolved thread is left out; the comment from before the push is not chosen by default (D87).
    expect(
      comments.items.map((c) => [c.kind, c.path, c.line, c.messages.map((m) => m.author), c.selectedByDefault]),
    ).toEqual([
      [ReviewCommentKind.Thread, 'greet.ts', 1, ['alice', 'bob'], true],
      [ReviewCommentKind.General, null, null, ['ci-bot'], false],
      [ReviewCommentKind.General, null, null, ['alice'], true],
    ]);

    const revised = 'export const greet = (name: string) => (name === "" ? "hello!" : "hello, " + name);\n';
    t.fake.enqueue(script().edit('greet.ts', revised).callTool('submit_result', { summary: 'Handled empty names' }), {
      title: '· 按审查意见修改',
      directory: worktree,
    });
    const review = waitForEvent(
      t.app.events,
      ServerEventType.TaskUpdated,
      (d) => d.id === task.id && d.status === 'review',
    );
    const chosen = comments.items.filter((c) => c.selectedByDefault).map((c) => c.id);
    // Reopening an archived task brings it back to the list (D219).
    expect((await t.call(archiveTaskOp, { id: task.id })).body).toMatchObject({ archivedAt: expect.any(Number) });
    const { body: running } = await t.call(reviseFromReviewOp, {
      id: task.id,
      commentIds: chosen,
      note: 'Keep the export name.',
    });
    expect(running).toMatchObject({
      status: 'running',
      finishedAt: null,
      archivedAt: null,
      git: { worktreePath: worktree },
    });
    expect(running.nodes.map((n) => [n.key, n.kind]).at(-1)).toEqual(['review_fix_1', 'revise']);
    await review;
    await t.fake.settled();

    // The AI worked on top of the reviewer's commit, and read the chosen comments and the note.
    const log = await runGit(['log', '--format=%H', '-3'], { cwd: worktree });
    expect(log.stdout.split('\n')).toContain(suggested);
    const prompt = t.fake.prompts.find((p) => p.text.includes('Handle an empty name here.'));
    expect(prompt?.text).toContain('Please add a test.');
    expect(prompt?.text).toContain('Keep the export name.');
    expect(prompt?.text).not.toContain('Coverage 85%');

    const { body: inReview } = await t.call(getTaskOp, { id: task.id });
    expect(inReview.pullRequest?.url).toBe('https://github.example/acme/shop/pull/1');
    const revisionDiff = await t.call(taskDiffFileOp, { id: task.id, path: 'greet.ts' });
    expect('diff' in revisionDiff.body && revisionDiff.body.diff).toContain('+export const greet = (name: string)');
    const { body: pushed } = await t.call(deliverTaskOp, { id: task.id, strategy: 'pull_request' });
    expect(pushed).toMatchObject({
      status: 'completed',
      lastDelivery: { status: 'succeeded', prUrl: 'https://github.example/acme/shop/pull/1' },
      git: { worktreeStatus: 'removed' },
    });
    // Pushed to the same pull request: none was opened, and the remote branch has the AI's change.
    expect(hosting.pullRequests).toHaveLength(1);
    const remote = await runGit(['show', `refs/heads/${branch}:greet.ts`], { cwd: origin, verbatim: true });
    expect(remote.stdout).toBe(revised);
  });

  it('GitLab：未解决的讨论带文件与行，普通评论为对话评论', async () => {
    const { task, branch } = await deliveredAsPullRequest({ provider: 'gitlab', repo: 'group/shop' });
    hosting.addReviewThread(branch, { path: 'greet.ts', line: 1, messages: [{ author: 'alice', body: 'Rename it' }] });
    hosting.addReviewThread(branch, {
      path: 'greet.ts',
      line: 1,
      resolved: true,
      messages: [{ author: 'bob', body: 'Ok' }],
    });
    hosting.addComment(branch, { author: 'bob', body: 'Looks fine otherwise' });

    const { body } = await t.call(reviewCommentsOp, { id: task.id });
    expect(body.pullRequest.url).toBe('https://gitlab.example/group/shop/-/merge_requests/1');
    expect(body.items.map((c) => [c.kind, c.path, c.line, c.messages[0]?.body, c.selectedByDefault])).toEqual([
      [ReviewCommentKind.Thread, 'greet.ts', 1, 'Rename it', true],
      [ReviewCommentKind.General, null, null, 'Looks fine otherwise', true],
    ]);
  });

  it('PR 已关闭、意见已不在、分支两边分叉时不做任何改动', async () => {
    const { origin, repo, task, branch } = await deliveredAsPullRequest({ provider: 'github', repo: 'acme/shop' });
    hosting.addReviewThread(branch, { path: 'greet.ts', line: 1, messages: [{ author: 'alice', body: 'Fix it' }] });
    const { body: comments } = await t.call(reviewCommentsOp, { id: task.id });
    const ids = comments.items.map((c) => c.id);

    const unknown = await t.call(reviseFromReviewOp, { id: task.id, commentIds: [...ids, 'PRRT_gone'] });
    expect([unknown.status, unknown.raw.json().error.code]).toEqual([400, ErrorCode.ValidationFailed]);

    // Both sides have a commit of their own: nothing is rebased, merged or overwritten.
    await reviewerCommits(origin, branch, 'greet.ts', 'export const greet = "remote";\n');
    const local = (await repo.git('rev-parse', branch)).trim();
    const tree = (await repo.git('rev-parse', `${branch}^{tree}`)).trim();
    const own = (await repo.git('commit-tree', tree, '-p', local, '-m', 'local')).trim();
    await repo.git('update-ref', `refs/heads/${branch}`, own);
    const diverged = await t.call(reviseFromReviewOp, { id: task.id, commentIds: ids });
    expect([diverged.status, diverged.raw.json().error.code]).toEqual([409, ErrorCode.BranchDiverged]);
    expect((await repo.git('rev-parse', branch)).trim()).toBe(own);
    const { body: unchanged } = await t.call(getTaskOp, { id: task.id });
    expect(unchanged).toMatchObject({ status: 'completed', git: { worktreeStatus: 'removed' } });
    expect(existsSync(task.git.worktreePath ?? '')).toBe(false);

    hosting.closePullRequest(branch);
    const closed = await t.call(reviewCommentsOp, { id: task.id });
    expect([closed.status, closed.raw.json().error.code]).toEqual([409, ErrorCode.PullRequestNotOpen]);
  });

  it('本地合并交付的任务没有 PR：409 PULL_REQUEST_NOT_OPEN', async () => {
    const { repo, task } = await deliveredAsPullRequest({ provider: 'github', repo: 'acme/shop' });
    const merged = await taskInReview(t, task.project.id, { 'other.ts': 'x\n' }, 'Other change');
    await t.call(deliverTaskOp, { id: merged.id, strategy: 'squash' });
    expect(await readFile(join(repo.path, 'other.ts'), 'utf8')).toBe('x\n');

    const res = await t.call(reviseFromReviewOp, { id: merged.id, commentIds: ['any'] });
    expect([res.status, res.raw.json().error.code]).toEqual([409, ErrorCode.PullRequestNotOpen]);
  });
});
