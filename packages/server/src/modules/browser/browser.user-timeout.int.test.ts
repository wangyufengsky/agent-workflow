import { BROWSER_READ_TIMEOUT_MS, ErrorCode, updateProjectOp } from '@aw/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createFakeClock } from '../../../test/helpers/clock.ts';
import { addProject, createTask, taskReaches } from '../../../test/helpers/tasks.ts';
import { systemClock } from '../../core/clock.ts';
import { createChromiumHost } from './host.chromium.ts';

let t: TestApp;
let host: ReturnType<typeof createChromiumHost>;
let taskId: string;
let holdMethod: string | null;
let reached: ReturnType<typeof Promise.withResolvers<string>>;
let release: ReturnType<typeof Promise.withResolvers<void>>;
let deadline: ReturnType<typeof createFakeClock>;
let deadlines: Set<() => void>;
let closed: string[];

beforeEach(async () => {
  host = createChromiumHost();
  reached = Promise.withResolvers<string>();
  release = Promise.withResolvers<void>();
  deadline = createFakeClock();
  deadlines = new Set();
  closed = [];
  holdMethod = null;
  t = await createTestApp({
    // 真实预览进程和 DOM 稳定计时照常运行，仅把 30 秒整体截止交给 FakeClock。
    clock: {
      now: systemClock.now,
      schedule(ms, fn) {
        if (ms !== BROWSER_READ_TIMEOUT_MS) return systemClock.schedule(ms, fn);
        deadlines.add(fn);
        const cancel = deadline.schedule(ms, fn);
        return () => {
          deadlines.delete(fn);
          cancel();
        };
      },
    },
    browserHost: {
      onEvent: host.onEvent,
      async request(op) {
        const result = await host.request(op);
        // 实际 Chromium 执行后暂缓 CDP 回应，复现页面线程/原生对话框挂起时的等待。
        if (op.tabId.startsWith('user-preview:') && op.kind === 'cdp' && op.method === holdMethod) {
          reached.resolve(op.tabId);
          await release.promise;
        }
        if (op.kind === 'close' && op.tabId.startsWith('user-preview:')) closed.push(op.tabId);
        return result;
      },
    },
  });
  const { project } = await addProject(t, {
    files: {
      'server.mjs': `import { createServer } from 'node:http';
createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8');
res.end('<title>用户预览</title><h1>保留我的页面</h1>');
}).listen(Number(process.env.PORT), '127.0.0.1');`,
    },
  });
  await t.call(updateProjectOp, {
    id: project.id,
    preview: { command: 'node server.mjs', setupCommand: null, readyPath: '/', pages: ['/'], extraOrigins: [] },
  });
  const planned = taskReaches(t, 'plan_review');
  taskId = (await createTask(t, { projectId: project.id, workflow: 'bugfix', checkpoints: { confirm_plan: true } })).id;
  await planned;
});

afterEach(async () => {
  holdMethod = null;
  release.resolve();
  await t.close();
  await host.close();
});

const timeout = {
  code: ErrorCode.BrowserReadFailed,
  details: { reason: 'timeout', timeoutMs: BROWSER_READ_TIMEOUT_MS },
};

it('读取的 Runtime 等待到截止即失败，不关闭用户页或解绑；回应恢复后可再次读取', async () => {
  const browser = t.app.services.browser;
  const { tabId } = await browser.openUserTab(taskId);
  browser.bindPreview('conversation', { taskId, tabId });
  holdMethod = 'Runtime.evaluate';
  const read = expect(browser.readPreview('conversation')).rejects.toMatchObject(timeout);
  expect(await reached.promise).toBe(tabId);
  deadline.advance(BROWSER_READ_TIMEOUT_MS);
  await read;
  expect(closed).toEqual([]);
  expect(deadlines.size).toBe(0);
  holdMethod = null;
  release.resolve();
  const recovered = await browser.readPreview('conversation');
  expect(recovered.page).toContain('保留我的页面');
  expect(deadlines.size).toBe(0);
});

it('已有用户页导航超时保留页签与关联，迟到响应不阻止后续读取', async () => {
  const browser = t.app.services.browser;
  const { tabId } = await browser.openUserTab(taskId);
  browser.bindPreview('conversation', { taskId, tabId });
  holdMethod = 'Page.navigate';
  const navigation = expect(browser.navigateUserTab(tabId, '/next')).rejects.toMatchObject(timeout);
  await reached.promise;
  deadline.advance(BROWSER_READ_TIMEOUT_MS);
  await navigation;
  expect(closed).toEqual([]);
  expect(deadlines.size).toBe(0);
  holdMethod = null;
  release.resolve();
  expect((await browser.readPreview('conversation')).page).toContain('保留我的页面');
});

it.each(['timeout', 'shutdown'] as const)('初次导航悬挂遇到 %s，关闭新页并结束 opening，不阻塞退出', async (reason) => {
  const browser = t.app.services.browser;
  holdMethod = 'Page.navigate';
  const opened = expect(browser.openUserTab(taskId)).rejects.toMatchObject(
    reason === 'timeout' ? timeout : { code: ErrorCode.BrowserNotOpen },
  );
  const tabId = await reached.promise;
  if (reason === 'timeout') deadline.advance(BROWSER_READ_TIMEOUT_MS);
  else await browser.closeAll();
  await opened;
  expect(closed).toContain(tabId);
  expect(deadlines.size).toBe(0);
  // 原始 CDP 回应仍被挡住时，应用也已经可以完成浏览器收尾。
  await browser.closeAll();
  await expect(host.request({ kind: 'close', tabId })).resolves.toBeNull();
});

it('同任务并发打开共同等待初次导航，不提前返回随后会被关闭的页签', async () => {
  const browser = t.app.services.browser;
  holdMethod = 'Page.navigate';
  const first = expect(browser.openUserTab(taskId)).rejects.toMatchObject(timeout);
  const tabId = await reached.promise;
  const second = expect(browser.openUserTab(taskId)).rejects.toMatchObject(timeout);
  const both = Promise.all([first, second]);
  deadline.advance(BROWSER_READ_TIMEOUT_MS);
  await both;
  expect(closed).toEqual([tabId]);
  expect(deadlines.size).toBe(0);
});
