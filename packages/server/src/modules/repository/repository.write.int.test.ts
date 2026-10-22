import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createProjectOp,
  deliverTaskOp,
  ErrorCode,
  getTaskOp,
  gitChangesOp,
  gitCreateBranchOp,
  gitCreateCommitOp,
  gitDeleteBranchOp,
  gitFetchOp,
  gitMergeOp,
  gitMergeWithAiOp,
  gitPullOp,
  gitPushOp,
  gitPushPreviewOp,
  gitStageOp,
  gitStatusOp,
  gitSwitchBranchOp,
  gitUnstageOp,
  listWorkflowsOp,
  ServerEventType,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { createTestRepo, type TestRepo } from '../../../test/helpers/git.ts';
import { taskInReview } from '../../../test/helpers/tasks.ts';
import { runGit } from '../git/index.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const OTHER = ['-c', 'user.name=Colleague', '-c', 'user.email=colleague@example.com'];

/** The user's repository with their identity configured, pushed to a bare `origin`. */
async function setUp(files: Record<string, string> = {}) {
  const origin = await mkdtemp(join(tmpdir(), 'aw-origin-'));
  await runGit(['init', '-q', '--bare', origin], { cwd: origin });
  const repo = await createTestRepo({ files, origin });
  await repo.git('config', 'user.name', 'Zhang Wei');
  await repo.git('config', 'user.email', 'zhang@example.com');
  await repo.git('push', '-q', '-u', 'origin', 'main');
  const { body: project } = await t.call(createProjectOp, { repoPath: repo.path });
  return { origin, repo, project };
}

/** A colleague pushes a commit to `branch` of origin. */
async function colleaguePushes(origin: string, branch: string, file: string, content: string): Promise<void> {
  const clone = await mkdtemp(join(tmpdir(), 'aw-clone-'));
  await runGit(['clone', '-q', '--branch', branch, origin, clone], { cwd: clone });
  await writeFile(join(clone, file), content);
  await runGit(['add', '-A'], { cwd: clone });
  await runGit([...OTHER, 'commit', '-q', '-m', `colleague: ${file}`], { cwd: clone });
  await runGit(['push', '-q', 'origin', branch], { cwd: clone });
}

const errorOf = (res: { status: number; raw: { json(): { error: { code: string } } } }) => [
  res.status,
  res.raw.json().error.code,
];

async function commitFile(repo: TestRepo, file: string, content: string, message: string): Promise<void> {
  await writeFile(join(repo.path, file), content);
  await repo.git('add', '-A');
  await repo.git('commit', '-q', '-m', message);
}

describe('Git 工作台：暂存与提交（27 §3.2）', () => {
  it('分组列出改动；暂存后以用户身份提交、运行用户的钩子；没有暂存时 GIT_NOTHING_TO_COMMIT', async () => {
    const { repo, project } = await setUp({ 'a.ts': 'a\n' });
    await writeFile(join(repo.path, 'a.ts'), 'a2\n');
    await writeFile(join(repo.path, 'new.ts'), 'new\n');
    expect((await t.call(gitChangesOp, { id: project.id })).body).toEqual({
      staged: [],
      unstaged: [
        { path: 'a.ts', status: 'modified', additions: 1, deletions: 1 },
        { path: 'new.ts', status: 'added', additions: 1, deletions: 0 },
      ],
    });

    await t.call(gitStageOp, { id: project.id, paths: ['a.ts', 'new.ts'] });
    await t.call(gitUnstageOp, { id: project.id, paths: ['new.ts'] });
    const { body: changes } = await t.call(gitChangesOp, { id: project.id });
    expect([changes.staged.map((f) => f.path), changes.unstaged.map((f) => f.path)]).toEqual([['a.ts'], ['new.ts']]);

    // The user's commit-msg hook runs (D108): it appends a trailer.
    const hook = join(repo.path, '.git/hooks/commit-msg');
    await writeFile(hook, '#!/bin/sh\nprintf "\\nHooked-by: user\\n" >> "$1"\n');
    await chmod(hook, 0o755);
    const { status, body: commit } = await t.call(gitCreateCommitOp, { id: project.id, message: 'Change a' });
    expect(status).toBe(201);
    expect(commit).toMatchObject({ subject: 'Change a', authorName: 'Zhang Wei', authorEmail: 'zhang@example.com' });
    expect(commit.body).toBe('Hooked-by: user');

    const nothing = await t.call(gitCreateCommitOp, { id: project.id, message: 'Again' });
    expect(errorOf(nothing)).toEqual([409, ErrorCode.GitNothingToCommit]);
    expect((await t.call(gitStatusOp, { id: project.id })).body).toMatchObject({
      branch: 'main',
      ahead: 1,
      operation: null,
      identity: { name: 'Zhang Wei', email: 'zhang@example.com' },
    });
  });

  it('钩子拒绝时提交失败并带上钩子输出，暂存区不变；没有身份时 GIT_IDENTITY_MISSING', async () => {
    const { repo, project } = await setUp();
    const hook = join(repo.path, '.git/hooks/pre-commit');
    await writeFile(hook, '#!/bin/sh\necho "lint failed" >&2\nexit 1\n');
    await chmod(hook, 0o755);
    await writeFile(join(repo.path, 'README.md'), 'changed\n');
    await t.call(gitStageOp, { id: project.id, paths: ['README.md'] });

    const rejected = await t.call(gitCreateCommitOp, { id: project.id, message: 'Change' });
    expect(errorOf(rejected)).toEqual([500, ErrorCode.GitCommandFailed]);
    expect(rejected.raw.json().error.details.stderr).toContain('lint failed');
    expect((await t.call(gitChangesOp, { id: project.id })).body.staged.map((f) => f.path)).toEqual(['README.md']);

    await repo.git('config', '--unset', 'user.name');
    await repo.git('config', '--unset', 'user.email');
    expect((await t.call(gitStatusOp, { id: project.id })).body.identity).toBeNull();
    expect(errorOf(await t.call(gitCreateCommitOp, { id: project.id, message: 'Change' }))).toEqual([
      400,
      ErrorCode.GitIdentityMissing,
    ]);
  });
});

describe('Git 工作台：推送与拉取（27 §3.3）', () => {
  it('新分支推送前列出提交，推送后设好上游；远端有本地没有的提交时 GIT_PUSH_REJECTED，不强推', async () => {
    const { origin, repo, project } = await setUp();
    await t.call(gitCreateBranchOp, { id: project.id, name: 'feature/x', startPoint: 'main', switch: true });
    await commitFile(repo, 'x.ts', 'x\n', 'Add x');

    const { body: preview } = await t.call(gitPushPreviewOp, { id: project.id, branch: 'feature/x' });
    expect(preview).toMatchObject({ remoteBranch: 'origin/feature/x', isNew: true, total: 1 });
    expect(preview.commits.map((c) => c.subject)).toEqual(['Add x']);
    await t.call(gitPushOp, { id: project.id, branch: 'feature/x' });
    expect(await runGit(['rev-parse', 'feature/x'], { cwd: origin })).toMatchObject({
      stdout: (await repo.git('rev-parse', 'feature/x')).trim(),
    });
    expect((await t.call(gitStatusOp, { id: project.id })).body).toMatchObject({ upstream: 'origin/feature/x' });

    await colleaguePushes(origin, 'feature/x', 'y.ts', 'y\n');
    await commitFile(repo, 'z.ts', 'z\n', 'Add z');
    const rejected = await t.call(gitPushOp, { id: project.id, branch: 'feature/x' });
    expect(errorOf(rejected)).toEqual([409, ErrorCode.GitPushRejected]);
    // Pulling cannot fast-forward over the local commit either: the user merges the remote branch themselves.
    expect(errorOf(await t.call(gitPullOp, { id: project.id }))).toEqual([409, ErrorCode.BranchDiverged]);
  });

  it('拉取只快进当前分支；有未提交改动时 WORKTREE_DIRTY，没有上游时 GIT_NO_UPSTREAM', async () => {
    const { origin, repo, project } = await setUp();
    await colleaguePushes(origin, 'main', 'remote.ts', 'r\n');
    await writeFile(join(repo.path, 'README.md'), 'local edit\n');
    expect(errorOf(await t.call(gitPullOp, { id: project.id }))).toEqual([409, ErrorCode.WorktreeDirty]);

    await repo.git('checkout', '--', 'README.md');
    await t.call(gitPullOp, { id: project.id });
    expect(await readFile(join(repo.path, 'remote.ts'), 'utf8')).toBe('r\n');
    expect((await t.call(gitStatusOp, { id: project.id })).body).toMatchObject({ ahead: 0, behind: 0 });

    await t.call(gitCreateBranchOp, { id: project.id, name: 'local-only', startPoint: 'main', switch: true });
    expect(errorOf(await t.call(gitPullOp, { id: project.id }))).toEqual([409, ErrorCode.GitNoUpstream]);
  });
});

describe('Git 工作台：分支（27 §3.4）', () => {
  it('新建、切换（远端分支建本地跟踪分支）、删除；任务前缀与重名被拒，未合并的分支要 force', async () => {
    const { origin, repo, project } = await setUp();
    expect(
      errorOf(await t.call(gitCreateBranchOp, { id: project.id, name: 'aw/T-9', startPoint: 'main', switch: false })),
    ).toEqual([400, ErrorCode.ValidationFailed]);
    await t.call(gitCreateBranchOp, { id: project.id, name: 'topic', startPoint: 'main', switch: false });
    expect(
      errorOf(await t.call(gitCreateBranchOp, { id: project.id, name: 'topic', startPoint: 'main', switch: false })),
    ).toEqual([409, ErrorCode.GitBranchExists]);

    await writeFile(join(repo.path, 'README.md'), 'wip\n');
    expect(errorOf(await t.call(gitSwitchBranchOp, { id: project.id, branch: 'topic' }))).toEqual([
      409,
      ErrorCode.WorktreeDirty,
    ]);
    await repo.git('checkout', '--', 'README.md');
    await t.call(gitSwitchBranchOp, { id: project.id, branch: 'topic' });
    await commitFile(repo, 't.ts', 't\n', 'Topic work');
    expect(errorOf(await t.call(gitDeleteBranchOp, { id: project.id, name: 'topic' }))).toEqual([
      409,
      ErrorCode.GitBranchInUse,
    ]);

    await colleaguePushes(origin, 'main', 'c.ts', 'c\n');
    await runGit([...OTHER, 'push', '-q', origin, 'main:refs/heads/shared'], { cwd: repo.path });
    await t.call(gitFetchOp, { id: project.id });
    await t.call(gitSwitchBranchOp, { id: project.id, branch: 'origin/shared' });
    expect((await t.call(gitStatusOp, { id: project.id })).body).toMatchObject({
      branch: 'shared',
      upstream: 'origin/shared',
    });

    expect(errorOf(await t.call(gitDeleteBranchOp, { id: project.id, name: 'topic' }))).toEqual([
      409,
      ErrorCode.GitBranchNotMerged,
    ]);
    await t.call(gitDeleteBranchOp, { id: project.id, name: 'topic', force: true });
    expect(await repo.git('branch', '--list', 'topic')).toBe('');
  });
});

describe('Git 工作台：合并（27 §3.5）', () => {
  it('合并提交与压缩以用户身份完成；冲突时中止，目标分支与主工作区不变；目标检出且有改动时 WORKTREE_DIRTY', async () => {
    const { repo, project } = await setUp({ 'greet.ts': 'hi\n' });
    await repo.git('checkout', '-q', '-b', 'feature');
    await commitFile(repo, 'feature.ts', 'f\n', 'Feature');
    await repo.git('checkout', '-q', '-b', 'other', 'main');
    await commitFile(repo, 'other.ts', 'o\n', 'Other');
    await repo.git('checkout', '-q', 'main');

    const merged = await t.call(gitMergeOp, {
      id: project.id,
      source: 'feature',
      target: 'main',
      strategy: 'merge',
      message: "Merge branch 'feature'",
    });
    expect(merged.body).toMatchObject({ merged: true });
    expect(await repo.git('log', '-1', '--format=%P%x00%an%x00%s')).toMatch(
      /^\S+ \S+\0Zhang Wei\0Merge branch 'feature'$/,
    );

    // `other` is checked out nowhere: squashed in a temporary worktree.
    await t.call(gitMergeOp, { id: project.id, source: 'other', target: 'main', strategy: 'squash', message: 'Other' });
    expect(await repo.git('log', '-1', '--format=%P %an %s')).toMatch(/^\S+ Zhang Wei Other$/);
    expect(await readFile(join(repo.path, 'other.ts'), 'utf8')).toBe('o\n');

    await repo.git('checkout', '-q', '-b', 'clash', 'main~2');
    await commitFile(repo, 'greet.ts', 'hey\n', 'Hey');
    await repo.git('checkout', '-q', 'main');
    await commitFile(repo, 'greet.ts', 'hello\n', 'Hello');
    const before = (await repo.git('rev-parse', 'main')).trim();
    const conflict = await t.call(gitMergeOp, {
      id: project.id,
      source: 'clash',
      target: 'main',
      strategy: 'merge',
      message: 'Merge clash',
    });
    expect(conflict.body).toEqual({ merged: false, conflictFiles: ['greet.ts'] });
    expect((await repo.git('rev-parse', 'main')).trim()).toBe(before);
    expect((await t.call(gitStatusOp, { id: project.id })).body).toMatchObject({ clean: true, operation: null });

    await writeFile(join(repo.path, 'greet.ts'), 'wip\n');
    const dirty = await t.call(gitMergeOp, {
      id: project.id,
      source: 'clash',
      target: 'main',
      strategy: 'squash',
      message: 'Clash',
    });
    expect(errorOf(dirty)).toEqual([409, ErrorCode.WorktreeDirty]);
  });

  it('冲突交给 AI：合并任务从来源分支开始、留下冲突标记，AI 解决后用户合并，目标分支得到两边的改动', async () => {
    const { repo, project } = await setUp({ 'greet.ts': 'hi\n' });
    await repo.git('checkout', '-q', '-b', 'clash');
    await commitFile(repo, 'greet.ts', 'hey\n', 'Hey');
    await repo.git('checkout', '-q', 'main');
    await commitFile(repo, 'greet.ts', 'hello\n', 'Hello');

    const resolved = 'hello, hey\n';
    t.fake.enqueue(script().edit('greet.ts', resolved).callTool('submit_result', { summary: 'Kept both' }), {
      title: '· 解决合并冲突',
    });
    const review = waitForEvent(t.app.events, ServerEventType.TaskUpdated, (d) => d.status === 'review');
    const { status, body: task } = await t.call(gitMergeWithAiOp, { id: project.id, source: 'clash', target: 'main' });
    expect(status).toBe(201);
    expect(task).toMatchObject({ title: '合并 clash → main', workflow: { key: 'merge_branch' } });
    expect(task.git.baseBranch).toBe('main');
    await review;
    await t.fake.settled();

    // The step was started on the source with main merged in and the conflict left for it.
    const worktree = (await t.call(getTaskOp, { id: task.id })).body.git.worktreePath ?? '';
    const parents = await runGit(['log', '-1', '--format=%P'], { cwd: worktree });
    expect(parents.stdout.split(' ')).toEqual([
      (await repo.git('rev-parse', 'clash')).trim(),
      (await repo.git('rev-parse', 'main')).trim(),
    ]);

    const { body: done } = await t.call(deliverTaskOp, { id: task.id, strategy: 'rebase' });
    expect(done).toMatchObject({ status: 'completed', lastDelivery: { status: 'succeeded' } });
    expect(await readFile(join(repo.path, 'greet.ts'), 'utf8')).toBe(resolved);
    // The system workflow is not one the user can pick.
    expect((await t.call(listWorkflowsOp, {})).body.items.map((w) => w.key)).not.toContain('merge_branch');
  });
});

describe('Git 工作台与任务的边界（27 §5）', () => {
  it('进行中任务的分支不能在工作台推送、合并或删除', async () => {
    const { project } = await setUp({ 'greet.ts': 'hi\n' });
    const task = await taskInReview(t, project.id, { 'greet.ts': 'hello\n' });
    const branch = task.git.branch ?? '';
    for (const res of [
      await t.call(gitPushOp, { id: project.id, branch }),
      await t.call(gitDeleteBranchOp, { id: project.id, name: branch, force: true }),
      await t.call(gitMergeOp, { id: project.id, source: branch, target: 'main', strategy: 'merge', message: 'M' }),
    ]) {
      expect(errorOf(res)).toEqual([409, ErrorCode.GitBranchOwnedByTask]);
    }
  });
});
