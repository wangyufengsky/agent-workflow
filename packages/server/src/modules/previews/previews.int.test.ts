import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  cancelTaskOp,
  ErrorCode,
  getPreviewOp,
  type ProjectPreview,
  ServerEventType,
  startPreviewOp,
  stopPreviewOp,
  trialPreviewOp,
  updateProjectOp,
  updateSettingsOp,
} from '@aw/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createFakeClock } from '../../../test/helpers/clock.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, createTask, taskReaches } from '../../../test/helpers/tasks.ts';

/** Answers every request with the directory it runs in, once listening on PORT. */
const SERVER = `import { createServer } from 'node:http';
createServer((req, res) => res.end(process.cwd()))
  .listen(Number(process.env.PORT), '127.0.0.1', () => console.log('listening'));
`;
/** Counts its runs in the worktree. */
const SETUP = `import { appendFileSync } from 'node:fs';
appendFileSync('setup-runs.txt', 'x');
`;
const PREVIEW: ProjectPreview = {
  command: 'node server.mjs',
  setupCommand: 'node setup.mjs',
  readyPath: '/',
  pages: ['/'],
  extraOrigins: [],
};

let t: TestApp;
afterEach(async () => t.close());

/** A task paused for plan review: its worktree is ready and nothing else runs in it. */
async function taskWithWorktree(options: { preview?: ProjectPreview | null } = {}) {
  const { project } = await addProject(t, { files: { 'server.mjs': SERVER, 'setup.mjs': SETUP } });
  await t.call(updateProjectOp, { id: project.id, preview: options.preview === undefined ? PREVIEW : options.preview });
  const reviewing = taskReaches(t, 'plan_review');
  const task = await createTask(t, { projectId: project.id, workflow: 'bugfix', checkpoints: { confirm_plan: true } });
  await reviewing;
  const worktree = t.app.services.worktrees.findByTask(task.id);
  if (worktree === undefined) throw new Error('No worktree');
  return { project, task, worktree };
}

const answers = async (url: string | null) => {
  if (url === null) throw new Error('No preview address');
  return (await fetch(url)).text();
};
const refuses = (url: string | null) => expect(fetch(`${url}`)).rejects.toThrow();

describe('页面预览', () => {
  it('在任务的 worktree 里启动开发服务器，停止后端口不再响应', async () => {
    t = await createTestApp();
    const { task, worktree } = await taskWithWorktree();

    const { status, body: running } = await t.call(startPreviewOp, { taskId: task.id });
    expect(status).toBe(200);
    expect(running).toMatchObject({ taskId: task.id, state: 'running', logTail: expect.stringContaining('listening') });
    expect(await answers(running.url)).toBe(worktree.path);

    const { body: stopped } = await t.call(stopPreviewOp, { taskId: task.id });
    expect(stopped).toMatchObject({ state: 'stopped', url: null });
    await refuses(running.url);
    expect((await t.call(getPreviewOp, { taskId: task.id })).body.state).toBe('stopped');
  });

  it('安装命令只在这个 worktree 第一次启动前运行', async () => {
    t = await createTestApp();
    const { task, worktree } = await taskWithWorktree();
    await t.call(startPreviewOp, { taskId: task.id });
    await t.call(stopPreviewOp, { taskId: task.id });
    await t.call(startPreviewOp, { taskId: task.id });

    expect(await readFile(join(worktree.path, 'setup-runs.txt'), 'utf8')).toBe('x');
  });

  it('开发服务器没就绪就退出时 PREVIEW_START_FAILED，预览为 failed 并保留日志末尾', async () => {
    t = await createTestApp();
    const { task } = await taskWithWorktree({
      preview: { ...PREVIEW, command: `node -e "console.log('boom'); process.exit(3)"` },
    });

    const { status, raw } = await t.call(startPreviewOp, { taskId: task.id });
    expect(status).toBe(502);
    expect(raw.json()).toMatchObject({
      error: { code: ErrorCode.PreviewStartFailed, details: { logTail: expect.stringContaining('boom') } },
    });
    expect((await t.call(getPreviewOp, { taskId: task.id })).body).toMatchObject({
      state: 'failed',
      logTail: expect.stringContaining('boom'),
    });
  });

  it('项目没有预览设置时 PREVIEW_NOT_CONFIGURED，任务还没有 worktree 时 STATE_TRANSITION_INVALID', async () => {
    t = await createTestApp();
    const { task } = await taskWithWorktree({ preview: null });
    expect((await t.call(startPreviewOp, { taskId: task.id })).raw.json()).toMatchObject({
      error: { code: ErrorCode.PreviewNotConfigured },
    });

    const { project } = await addProject(t);
    const draft = await createTask(t, { projectId: project.id, workflow: 'bugfix', start: false });
    expect((await t.call(startPreviewOp, { taskId: draft.id })).raw.json()).toMatchObject({
      error: { code: ErrorCode.StateTransitionInvalid },
    });
  });

  it('删除任务的 worktree 前先停止预览', async () => {
    t = await createTestApp();
    const { task } = await taskWithWorktree();
    const { body: running } = await t.call(startPreviewOp, { taskId: task.id });

    expect((await t.call(cancelTaskOp, { id: task.id })).body.status).toBe('cancelled');
    expect((await t.call(getPreviewOp, { taskId: task.id })).body.state).toBe('stopped');
    await refuses(running.url);
  });

  it('没有标签页在用时空闲到期即停止；有标签页在用时不停', async () => {
    const clock = createFakeClock();
    t = await createTestApp({ clock });
    const { task } = await taskWithWorktree();
    await t.call(startPreviewOp, { taskId: task.id });
    const previews = t.app.services.previews;
    const idleMs = 10 * 60_000;

    previews.acquire(task.id);
    clock.advance(idleMs);
    expect(previews.get(task.id).state).toBe('running');

    const stopped = waitForEvent(t.app.events, ServerEventType.PreviewUpdated, (p) => p.state === 'stopped');
    previews.release(task.id);
    clock.advance(idleMs);
    await stopped;
  });

  it('达到同时运行上限时停掉最久没用的空闲预览；都在用时 PREVIEW_LIMIT_REACHED', async () => {
    t = await createTestApp();
    await t.call(updateSettingsOp, { 'preview.maxRunning': 1 });
    const first = await taskWithWorktree();
    const second = await taskWithWorktree();
    const { body: firstRunning } = await t.call(startPreviewOp, { taskId: first.task.id });

    expect((await t.call(startPreviewOp, { taskId: second.task.id })).body.state).toBe('running');
    expect((await t.call(getPreviewOp, { taskId: first.task.id })).body.state).toBe('stopped');
    await refuses(firstRunning.url);

    t.app.services.previews.acquire(second.task.id);
    const { status, raw } = await t.call(startPreviewOp, { taskId: first.task.id });
    expect(status).toBe(409);
    expect(raw.json()).toMatchObject({ error: { code: ErrorCode.PreviewLimitReached } });
  });

  it('试运行在主工作区启动一次，就绪后停止', async () => {
    t = await createTestApp();
    const { project } = await taskWithWorktree();

    const { status, body: trial } = await t.call(trialPreviewOp, { projectId: project.id });
    expect(status).toBe(200);
    expect(trial.logTail).toContain('listening');
    await refuses(trial.url);
  });
});
