import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createWorkflowOp,
  ErrorCode,
  getNodeOp,
  getTaskOp,
  skipCheckOp,
  stopPreviewOp,
  type TaskDetailDTO,
  updateProjectOp,
} from '@aw/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { addProject, createTask, taskReaches } from '../../../test/helpers/tasks.ts';
import { createChromiumHost } from './host.chromium.ts';

// The page check (29 §7) of a step, end to end: the task's preview is a real dev server in its worktree and the
// pages open in a real Chromium.

/**
 * Serves the worktree's pages as they are now (`/` is index.html, `/x` is x.html), so a step's edit shows on the
 * next request; `/api/me` answers 401 as an API does before login.
 */
const SERVER = `import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
createServer((req, res) => {
  const file = req.url === '/' ? 'index.html' : req.url.slice(1) + '.html';
  if (req.url === '/api/me') { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{}'); return; }
  if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(readFileSync(file));
}).listen(Number(process.env.PORT), '127.0.0.1', () => console.log('listening'));`;
const page = (body: string) =>
  `<!doctype html><html lang="zh"><head><title>首页</title></head><body>${body}</body></html>`;
const BROKEN = page(`<main><h1>首页</h1></main><script>console.error('boom')</script>`);
const FIXED = page('<main><h1>首页</h1></main>');

let host: ReturnType<typeof createChromiumHost>;
let t: TestApp;

beforeAll(() => {
  host = createChromiumHost();
});
afterAll(() => host.close());
afterEach(() => t.close());

/**
 * A project whose preview runs `command` (its pages: a broken index.html and `files`), and a fixed workflow of one
 * step checked by its page check.
 */
async function pageCheckedProject(command: string, files: Record<string, string> = {}) {
  t = await createTestApp({ browserHost: host });
  const { project } = await addProject(t, { files: { 'server.mjs': SERVER, 'index.html': BROKEN, ...files } });
  await t.call(updateProjectOp, {
    id: project.id,
    preview: { command, setupCommand: null, readyPath: '/', pages: ['/'], extraOrigins: [] },
  });
  await t.call(createWorkflowOp, {
    key: 'page_flow',
    name: 'Page flow',
    planning: 'fixed',
    deliverable: 'code_changes',
    definition: {
      allowedRoles: ['developer'],
      checkpoints: { confirm_plan: false, accept_each_node: false },
      defaultAcceptance: { checks: [], manual: false },
      template: {
        nodes: [
          {
            key: 'build',
            title: '页面',
            roleKey: 'developer',
            instructions: 'Build the page',
            dependsOn: [],
            acceptance: { checks: [{ kind: 'browser', viewports: ['desktop'] }], manual: false },
          },
        ],
      },
    },
  });
  return project;
}

const buildSessions = () => t.fake.sessions.filter((s) => s.agent === 'aw-executor' && s.title.endsWith('· 页面'));
const taskOf = async (id: string): Promise<TaskDetailDTO> => (await t.call(getTaskOp, { id })).body;

describe('页面体检', () => {
  it('页面报错时不通过，体检结果作为反馈发回 AI；改好后通过，截图可取', async () => {
    const project = await pageCheckedProject('node server.mjs');
    t.fake.enqueue(script().callTool('submit_result', { summary: 'Built' }), { title: '· 页面' });
    t.fake.enqueue(script().edit('index.html', FIXED).callTool('submit_result', { summary: 'Fixed the error' }), {
      title: '· 页面',
    });
    const review = taskReaches(t, 'review');
    const task = await createTask(t, { projectId: project.id, workflow: 'page_flow' });
    await review;

    expect(buildSessions()).toHaveLength(2);
    const retry = t.fake.prompts.find((p) => p.text.includes('The page check did not pass'));
    expect(retry?.text).toContain('FAIL / (desktop)\n  error [console] boom');
    const done = await taskOf(task.id);
    expect(done.result?.checks).toMatchObject([{ nodeKey: 'build', kind: 'browser', passed: true, skipped: false }]);
    const build = done.nodes.find((n) => n.key === 'build');
    const { body: node } = await t.call(getNodeOp, { id: task.id, nodeId: build?.id ?? '' });
    const check = node.checkResults?.[0];
    if (check?.kind !== 'browser') throw new Error('No page check');
    expect(check).toMatchObject({ passed: true, skipped: false, unrunnable: null });
    expect(check.pages).toMatchObject([{ path: '/', viewport: 'desktop', httpStatus: 200, errors: [] }]);

    const shot = await t.request({ method: 'GET', url: `/tasks/${task.id}/browser/${check.pages[0]?.screenshot}` });
    expect(shot.statusCode).toBe(200);
    expect(shot.headers['content-type']).toBe('image/jpeg');
    expect(shot.rawPayload.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  it('预览在这个 worktree 里从没启动成功：无法运行，不发回 AI、不消耗次数；跳过后继续，结果标明未验证', async () => {
    const project = await pageCheckedProject('node -e "process.exit(3)"');
    t.fake.enqueue(script().callTool('submit_result', { summary: 'Built' }), { title: '· 页面' });
    const failed = taskReaches(t, 'failed');
    const task = await createTask(t, { projectId: project.id, workflow: 'page_flow' });
    await failed;

    const stopped = await taskOf(task.id);
    expect(stopped.failure).toMatchObject({
      code: ErrorCode.BrowserCheckUnrunnable,
      details: { nodeKey: 'build', reason: 'preview_never_started' },
    });
    expect(stopped.nodes.find((n) => n.key === 'build')).toMatchObject({ status: 'failed', attemptCount: 0 });
    expect(buildSessions()).toHaveLength(1);

    const review = taskReaches(t, 'review');
    expect((await t.call(skipCheckOp, { id: task.id })).body.status).toBe('running');
    await review;
    expect(buildSessions()).toHaveLength(1);
    const { result } = await taskOf(task.id);
    expect(result?.checks.find((c) => c.kind === 'browser')).toMatchObject({ passed: true, skipped: true });
  });

  it('逐页逐视口收集事实：异常与 404 脚本不通过，接口 4xx 只提醒；启动过的预览这次起不来是普通的检查失败', async () => {
    const project = await pageCheckedProject('node server.mjs', {
      'index.html': FIXED,
      'broken.html': page(`<h1>坏了</h1><script src="/missing.js"></script><script>throw new Error('kaput')</script>`),
      'guest.html': page(`<h1>访客</h1><script>fetch('/api/me')</script>`),
    });
    const reviewing = taskReaches(t, 'plan_review');
    const task = await createTask(t, {
      projectId: project.id,
      workflow: 'page_flow',
      checkpoints: { confirm_plan: true },
    });
    await reviewing;
    const worktree = (await taskOf(task.id)).git.worktreePath ?? '';
    const request = { taskId: task.id, projectId: project.id, nodeId: 'n1', viewports: ['desktop', 'mobile'] as const };

    const checked = await t.app.services.browser.pageCheck(
      { ...request, pages: ['/', '/broken', '/guest'] },
      new AbortController().signal,
    );
    expect(checked.passed).toBe(false);
    expect(checked.pages.map((p) => [p.path, p.viewport, p.errors.map((e) => e.kind)])).toEqual([
      ['/', 'desktop', []],
      ['/', 'mobile', []],
      ['/broken', 'desktop', ['exception', 'request']],
      ['/broken', 'mobile', ['exception', 'request']],
      ['/guest', 'desktop', []],
      ['/guest', 'mobile', []],
    ]);
    expect(checked.pages[4]?.warnings).toMatchObject([{ kind: 'request', message: expect.stringContaining('401') }]);
    expect(checked.output).toContain('FAIL /broken (desktop)');

    await t.call(stopPreviewOp, { taskId: task.id });
    await writeFile(join(worktree, 'server.mjs'), 'process.exit(1)');
    const restarted = await t.app.services.browser.pageCheck(
      { ...request, pages: ['/'] },
      new AbortController().signal,
    );
    expect(restarted).toMatchObject({ passed: false, pages: [], unrunnable: null });
    expect(restarted.output).toContain('The page preview did not start');
  });
});
