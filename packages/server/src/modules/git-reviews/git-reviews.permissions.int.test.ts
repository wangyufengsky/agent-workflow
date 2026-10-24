import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError, ErrorCode, getProjectOp, resolveInboxOp, startGitReviewOp } from '@aw/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { addProject } from '../../../test/helpers/tasks.ts';
import { OpencodeEventType as E } from '../opencode/index.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await t.close();
});

async function reviewWithPermissions() {
  const { repo, project } = await addProject(t);
  await writeFile(join(repo.path, 'README.md'), 'changed\n');
  t.fake.enqueue(script().hang(), { agent: 'aw-code-reviewer' });
  await t.call(startGitReviewOp, { id: project.id, target: { kind: 'worktree' } });
  const session = t.fake.sessions.at(-1);
  if (session === undefined) throw new Error('missing review session');
  t.fake.replay(
    ['find-a', 'find-b', 'other'].map((permissionId) => ({
      type: E.PermissionAsked,
      sessionId: session.id,
      directory: repo.path,
      permissionId,
      permission: 'bash',
      patterns: [permissionId === 'other' ? 'ls -la' : `find . -name ${permissionId}`],
    })),
  );
  const items = t.app.services.inbox.listOpen({});
  const item = items.find((i) => i.kind === 'permission' && i.payload.opencodePermissionId === 'find-a');
  if (item === undefined) throw new Error('missing permission');
  return { project, session, item };
}

it('总是允许同时完成两条请求：SSE 先于 HTTP 返回且重复投递，关闭匹配卡片并保留无关请求', async () => {
  const { project, session, item } = await reviewWithPermissions();
  const replies = ['find-a', 'find-b'].map((permissionId) => ({
    type: E.PermissionReplied,
    sessionId: session.id,
    permissionId,
    reply: 'always' as const,
  }));
  vi.spyOn(t.fake, 'replyPermission').mockImplementation(async () => {
    t.fake.replay(replies);
  });
  const response = await t.call(resolveInboxOp, { id: item.id, response: { decision: 'always' } });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ status: 'resolved', response: { decision: 'always' } });
  t.fake.replay(replies);
  expect(t.app.services.inbox.listOpen({}).map((i) => i.title)).toEqual(['bash ls -la']);
  expect((await t.call(getProjectOp, { id: project.id })).body.allowedBash).toEqual(['find *']);
  expect(t.app.services.inbox.countBlocking()).toBe(1);
});

it('原生请求已失效时关闭残留卡片并返回明确错误，不记录用户尚未成功授予的权限', async () => {
  const { project, item } = await reviewWithPermissions();
  vi.spyOn(t.fake, 'replyPermission').mockRejectedValue(
    new AppError(ErrorCode.PermissionRequestExpired, 'Permission expired'),
  );
  const response = await t.call(resolveInboxOp, { id: item.id, response: { decision: 'always' } });
  expect(response.status).toBe(409);
  expect(response.body).toMatchObject({ error: { code: ErrorCode.PermissionRequestExpired } });
  expect(t.app.services.inbox.get(item.id)).toMatchObject({ status: 'dismissed', response: null });
  expect(t.app.services.inbox.countBlocking()).toBe(2);
  expect((await t.call(getProjectOp, { id: project.id })).body.allowedBash).toEqual([]);
});
