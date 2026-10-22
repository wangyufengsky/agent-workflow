import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject, type E2EProject, passReview, patchSettings, queueTurn, submitResult } from './helpers.ts';

// M6-02 (05): measured, not asserted against pixels; each test prints its numbers and they are collected in
// perf-results/. Targets: canvas interaction > 50 fps, a 5 MB session stream's first screen < 300 ms, no jank with
// ten tasks running at once.

type Task = { id: string; status: string; nodes: { id: string; key: string; title: string }[] };
type Node = { attempts: { id: string; kind: string; seq: number }[] };

const results: Record<string, unknown> = {};
const DATA_DIR = process.env.AW_PERF_DATA_DIR;

async function api<T>(request: APIRequestContext, method: 'GET' | 'POST', path: string, data?: object): Promise<T> {
  const res = await request.fetch(`${API_BASE}${path}`, { method, headers: AUTH, ...(data && { data }) });
  if (!res.ok()) throw new Error(`${method} ${path} failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

async function start(
  request: APIRequestContext,
  project: E2EProject,
  key: string,
  requirement: string,
  confirm = false,
) {
  const workflows = await api<{ items: { id: string; key: string }[] }>(request, 'GET', '/workflows');
  const workflowId = workflows.items.find((w) => w.key === key)?.id;
  const task = await api<Task>(request, 'POST', '/tasks', {
    projectId: project.id,
    workflowId,
    requirement,
    checkpoints: { confirm_plan: confirm },
  });
  return task.id;
}

async function waitForStatus(request: APIRequestContext, id: string, status: string, timeout = 30_000) {
  await expect.poll(async () => (await api<Task>(request, 'GET', `/tasks/${id}`)).status, { timeout }).toBe(status);
  return api<Task>(request, 'GET', `/tasks/${id}`);
}

type FrameStats = {
  fps: number;
  frames: number;
  worstFrameMs: number;
  p95FrameMs: number;
  longTasks: number;
  longestTaskMs: number;
};

/** Counts animation frames and long tasks (> 50 ms) in the page while `action` runs. */
async function measureFrames(page: Page, action: () => Promise<void>): Promise<FrameStats> {
  type Perf = { frames: number[]; long: number[]; stop: boolean; observer: PerformanceObserver };
  await page.evaluate(() => {
    const perf: Perf = { frames: [], long: [], stop: false, observer: new PerformanceObserver(() => {}) };
    perf.observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) perf.long.push(e.duration);
    });
    perf.observer.observe({ type: 'longtask' });
    const loop = (t: number) => {
      perf.frames.push(t);
      if (!perf.stop) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    Object.assign(window, { __perf: perf });
  });
  await action();
  return page.evaluate(() => {
    const perf = (window as unknown as { __perf: Perf }).__perf;
    perf.stop = true;
    perf.observer.disconnect();
    const { frames, long } = perf;
    const gaps = frames.slice(1).map((t, i) => t - (frames[i] ?? t));
    const sorted = [...gaps].sort((a, b) => a - b);
    const elapsed = (frames.at(-1) ?? 0) - (frames[0] ?? 0);
    return {
      fps: Math.round(((frames.length - 1) / elapsed) * 1000 * 10) / 10,
      frames: frames.length,
      worstFrameMs: Math.round(sorted.at(-1) ?? 0),
      p95FrameMs: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
      longTasks: long.length,
      longestTaskMs: Math.round(Math.max(0, ...long)),
    };
  });
}

/** Drags across the canvas in small steps for about `ms`, so input keeps arriving every frame. */
async function pan(page: Page, box: { x: number; y: number; width: number; height: number }, ms: number) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const end = Date.now() + ms;
  for (let i = 0; Date.now() < end; i++) {
    const a = i / 20;
    await page.mouse.move(cx + Math.cos(a) * 150, cy + Math.sin(a) * 100);
  }
  await page.mouse.up();
}

async function zoom(page: Page, box: { x: number; y: number; width: number; height: number }, ms: number) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const end = Date.now() + ms;
  for (let i = 0; Date.now() < end; i++) await page.mouse.wheel(0, i % 40 < 20 ? -60 : 60);
}

/** 19 steps in five layers, then the workflow's required final_verify after all of them: 20 nodes (PLAN_MAX_NODES). */
function twentyNodePlan() {
  const nodes = Array.from({ length: 19 }, (_, i) => {
    const layer = Math.floor(i / 4);
    const deps = layer === 0 ? [] : [`s${(layer - 1) * 4}`, `s${Math.min((layer - 1) * 4 + 1 + (i % 3), 18)}`];
    return {
      key: `s${i}`,
      title: `步骤 ${i + 1}：模块 ${String.fromCharCode(65 + (i % 26))} 的改动`,
      role: i % 5 === 4 ? 'tester' : 'developer',
      instructions: `Change module ${i}`,
      depends_on: [...new Set(deps)].filter((d) => d !== `s${i}`),
    };
  });
  const leaves = nodes.map((n) => n.key).filter((k) => !nodes.some((n) => n.depends_on.includes(k)));
  return [
    ...nodes,
    { key: 'final_verify', title: '整体验证', role: 'tester', instructions: 'Verify', depends_on: leaves },
  ];
}

test.afterAll(() => {
  const dir = 'perf-results';
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `perf-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`perf results: ${file}\n${JSON.stringify(results, null, 2)}`);
});

test('20 节点计划画布：只读与编辑画布的平移、缩放、拖动步骤', async ({ page, request }) => {
  test.setTimeout(120_000);
  await patchSettings(request, { 'ui.theme': 'deepseek', 'ui.mode': 'pro' });
  const project = await createProject(request, null);
  await queueTurn(request, project, { agent: 'aw-planner' }, [
    { type: 'callTool', name: 'submit_plan', args: { summary: '二十个步骤的计划。', nodes: twentyNodePlan() } },
  ]);
  const id = await start(request, project, 'feature', '二十个步骤的需求', true);
  await waitForStatus(request, id, 'plan_review');

  await page.goto(`/tasks/${id}`);
  const canvas = page.getByTestId('progress-canvas');
  await expect(canvas.getByTestId(/^step-/)).toHaveCount(20);
  const readonlyBox = await canvas.boundingBox();
  if (readonlyBox === null) throw new Error('no canvas');
  const readonly = {
    pan: await measureFrames(page, () => pan(page, readonlyBox, 3000)),
    zoom: await measureFrames(page, () => zoom(page, readonlyBox, 3000)),
  };

  await page.getByRole('button', { name: '编辑计划' }).click();
  const editor = page.getByTestId('plan-editor');
  await expect(editor.getByTestId(/^step-/)).toHaveCount(20);
  // The editor's canvas is its left part; the step form is on the right.
  const editorBox = await editor.boundingBox();
  if (editorBox === null) throw new Error('no editor');
  const editBox = { x: editorBox.x + 20, y: editorBox.y + 20, width: editorBox.width * 0.55, height: 500 };
  const nodeBox = await editor.getByTestId('step-s5').boundingBox();
  if (nodeBox === null) throw new Error('no node');
  const edit = {
    pan: await measureFrames(page, () => pan(page, editBox, 3000)),
    zoom: await measureFrames(page, () => zoom(page, editBox, 3000)),
    dragNode: await measureFrames(page, () => pan(page, nodeBox, 3000)),
  };
  results.canvas20 = { readonly, edit };
  console.log('canvas20', JSON.stringify(results.canvas20));
});

/** About 5 MB of a long execute session: streamed text (flushed as it grows), shell calls with long output, thinking. */
function fiveMegabyteTranscript(): string {
  const lines: string[] = [];
  let seq = 0;
  const ts = Date.now();
  const add = (entry: object) => lines.push(JSON.stringify({ seq: ++seq, ts, ...entry }));
  add({ kind: 'user_message', data: { text: 'PERF-START 需求：修复订单时间显示。' } });
  const para = '检查 src/order/time.ts 中的换算逻辑，确认时区处理与测试覆盖。'.repeat(8);
  const output = Array.from({ length: 120 }, (_, i) => `ok ${i} - order time spec ${i} (12ms)`).join('\n');
  for (let i = 0; lines.join('\n').length < 5 * 1024 * 1024 && i < 10_000; i++) {
    for (let k = 1; k <= 4; k++) {
      add({ kind: 'text', partId: `prt_${i}`, data: { text: `第 ${i} 轮：${para.slice(0, (para.length * k) / 4)}` } });
    }
    add({ kind: 'reasoning', partId: `rsn_${i}`, data: { text: `思考 ${i}：${para}` } });
    add({
      kind: 'tool_call',
      data: { tool: 'bash', callId: `call_${i}`, input: { command: `node --test test/${i}.test.ts` } },
    });
    add({ kind: 'tool_result', data: { tool: 'bash', callId: `call_${i}`, status: 'completed', output } });
  }
  return `${lines.join('\n')}\n`;
}

test('单会话流 5 MB：首屏时间与接口分页', async ({ page, request }) => {
  test.setTimeout(120_000);
  if (DATA_DIR === undefined) throw new Error('AW_PERF_DATA_DIR is unset: run with playwright.perf.config.ts');
  await patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'pro' });
  const project = await createProject(request, null);
  await queueTurn(request, project, { title: '定位根因' }, [submitResult('找到了根因')]);
  await queueTurn(request, project, { title: '修复' }, [submitResult('修复了')]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);
  const id = await start(request, project, 'bugfix', '订单时间显示错了');
  const task = await waitForStatus(request, id, 'review');
  const fix = task.nodes.find((n) => n.key === 'fix');
  if (fix === undefined) throw new Error('no fix node');
  const node = await api<Node>(request, 'GET', `/tasks/${id}/nodes/${fix.id}`);
  const execute = node.attempts.find((a) => a.kind === 'execute');
  const review = node.attempts.find((a) => a.kind === 'review');
  if (execute === undefined || review === undefined) throw new Error('attempts missing');
  const jsonl = fiveMegabyteTranscript();
  writeFileSync(join(DATA_DIR, 'runs', id, `${execute.id}.jsonl`), jsonl);

  // API: every page of the stream, one after another, as the renderer reads it.
  const apiStart = performance.now();
  let afterSeq = 0;
  let pages = 0;
  let firstPageMs = 0;
  for (;;) {
    const page = await api<{ lastSeq: number; done: boolean }>(
      request,
      'GET',
      `/attempts/${execute.id}/transcript?afterSeq=${afterSeq}`,
    );
    pages++;
    if (pages === 1) firstPageMs = performance.now() - apiStart;
    if (page.done || page.lastSeq === afterSeq) break;
    afterSeq = page.lastSeq;
  }
  const allPagesMs = performance.now() - apiStart;

  // UI: on the step page with the review attempt open, open the 5 MB execute attempt's stream and time until its
  // first entries are on screen (the next frame after they are in the DOM).
  await page.goto(`/tasks/${id}/nodes/${fix.id}?attempt=${review.id}`);
  await expect(page.getByTestId('stream-scroll')).toBeVisible();
  const switchMs = await page.evaluate(async (label) => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
    if (button === undefined) throw new Error(`no button ${label}`);
    const t0 = performance.now();
    button.click();
    await new Promise<void>((resolve) => {
      const check = () => {
        const streams = [...document.querySelectorAll('[data-testid="stream-scroll"]')];
        if (streams.some((el) => el.textContent?.includes('PERF-START'))) resolve();
        else requestAnimationFrame(check);
      };
      check();
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return performance.now() - t0;
  }, `执行 #${execute.seq}`);

  // Scrolling the loaded stream, inside its box.
  const list = page.getByTestId('stream-scroll').filter({ hasText: 'PERF-START' });
  await list.hover();
  const scroll = await measureFrames(page, async () => {
    for (let i = 0; i < 60; i++) await page.mouse.wheel(0, 400);
  });
  await expect(list).toBeVisible();

  results.transcript5mb = {
    bytes: jsonl.length,
    entries: jsonl.split('\n').length - 1,
    api: { pages, firstPageMs: Math.round(firstPageMs), allPagesMs: Math.round(allPagesMs) },
    ui: { firstScreenMs: Math.round(switchMs), scroll },
  };
  console.log('transcript5mb', JSON.stringify(results.transcript5mb));
});

test('10 个并发任务：主页与任务页在持续推送下不卡顿', async ({ page, request }) => {
  test.setTimeout(240_000);
  await patchSettings(request, {
    'ui.theme': 'github_white',
    'ui.mode': 'simple',
    'scheduler.maxConcurrentAttempts': 10,
  });
  const project = await createProject(request, null);
  // Each locate step streams text and reports progress for a while (every MCP call yields to the event loop).
  const chatter = Array.from({ length: 150 }, (_, i) => [
    { type: 'text' as const, text: `第 ${i} 步：阅读代码并分析。`.repeat(30) },
    { type: 'callTool' as const, name: 'report_progress', args: { message: `正在分析第 ${i} 处` } },
  ]).flat();
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) {
    await queueTurn(request, project, { title: '定位根因' }, [...chatter, submitResult(`任务 ${i} 找到了根因`)]);
    await queueTurn(request, project, { title: '修复' }, [...chatter.slice(0, 20), submitResult(`任务 ${i} 已修复`)]);
    await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);
  }
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今天想让 AI 做什么？' })).toBeVisible();
  const startedAt = performance.now();
  for (let i = 0; i < 10; i++) ids.push(await start(request, project, 'bugfix', `并发任务 ${i}：订单时间显示错了`));

  const latencies: number[] = [];
  const home = await measureFrames(page, async () => {
    for (const end = Date.now() + 5000, i = { n: 0 }; Date.now() < end; i.n++) {
      const t0 = performance.now();
      await api(request, 'GET', '/tasks');
      latencies.push(performance.now() - t0);
      await page.mouse.wheel(0, i.n % 2 === 0 ? 300 : -300);
    }
  });

  const first = ids[0];
  if (first === undefined) throw new Error('no task');
  const detail = await api<Task>(request, 'GET', `/tasks/${first}`);
  const locate = detail.nodes.find((n) => n.key === 'locate');
  await page.goto(`/tasks/${first}?node=${locate?.id}&open=true`);
  await page.getByRole('tab', { name: '过程' }).click();
  const taskPage = await measureFrames(page, async () => {
    for (const end = Date.now() + 5000; Date.now() < end; ) {
      const t0 = performance.now();
      await api(request, 'GET', `/tasks/${first}`);
      latencies.push(performance.now() - t0);
    }
  });

  for (const id of ids) await waitForStatus(request, id, 'review', 180_000);
  const sorted = [...latencies].sort((a, b) => a - b);
  results.concurrent10 = {
    allInReviewMs: Math.round(performance.now() - startedAt),
    home,
    taskPageWithLiveStream: taskPage,
    apiLatencyMs: { p50: Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0), max: Math.round(sorted.at(-1) ?? 0) },
  };
  console.log('concurrent10', JSON.stringify(results.concurrent10));
  await patchSettings(request, { 'scheduler.maxConcurrentAttempts': 4 });
});
