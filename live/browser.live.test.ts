import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AcceptanceCheckKind,
  getNodeOp,
  listPreviewSessionsOp,
  TaskStatus,
  type TranscriptEntry,
  updateSettingsOp,
} from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createChromiumHost } from '../packages/server/src/modules/browser/host.chromium.ts';
import { TEST_MODEL } from '../packages/server/test/helpers/model.ts';
import { type LiveApp, outcome, startLiveApp, TASK_TIMEOUT_MS } from './live-app.ts';

/**
 * B1's completion test (29 §13): a real model changes a page of todo-web and checks it in the browser through the
 * page preview, once with the default free model (it reads images) and once with a model without image input, which
 * has only the page snapshot. B2's too: the feature workflow's final verification runs the page check of the
 * project's key pages (29 §7), and every browser action left a frame (29 §5.7). Run by hand: `pnpm test:live live/browser.live.test.ts`; AW_LIVE_TEXT_MODEL picks the
 * text-only model.
 */
const TEXT_ONLY_MODEL = process.env.AW_LIVE_TEXT_MODEL ?? 'opencode-go/glm-5.3';
const REQUIREMENT =
  '给待办页面加一个「清空」按钮：点击后清空列表。改完后打开页面预览（路径 /），先添加一条待办，再点「清空」，确认列表为空。';

const host = createChromiumHost();
let live: LiveApp;
beforeAll(async () => {
  live = await startLiveApp('browser', { browserHost: host });
}, 120_000);
afterAll(async () => {
  await live.close();
  await host.close();
});

/** The browser tool calls in the task's transcripts, with whether each succeeded. */
async function browserCalls(taskId: string): Promise<Array<{ tool: string; ok: boolean }>> {
  const dir = join(live.t.dataDir, 'runs', taskId);
  const calls: Array<{ tool: string; ok: boolean }> = [];
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.jsonl'))) {
    const entries: TranscriptEntry[] = (await readFile(join(dir, file), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    for (const e of entries) {
      if (e.kind !== 'tool_result' || !/^agent-workflow_browser_/.test(e.data.tool)) continue;
      calls.push({ tool: e.data.tool.replace('agent-workflow_', ''), ok: e.data.status === 'completed' });
    }
  }
  return calls;
}

describe('@live 浏览器：改页面并在页面预览里验证', () => {
  it.each([
    ['默认模型（能看图）', TEST_MODEL],
    ['没有图片输入的模型', TEXT_ONLY_MODEL],
  ])(
    '%s',
    async (_label, model) => {
      await live.t.call(updateSettingsOp, { 'ai.defaultModel': model });
      const task = await live.runTask('feature', 'todo-web', REQUIREMENT);
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });

      const calls = await browserCalls(task.id);
      expect(calls).toContainEqual({ tool: 'browser_open', ok: true });
      expect(calls).toContainEqual({ tool: 'browser_click', ok: true });
      const html = await readFile(join(task.git.worktreePath ?? '', 'public/index.html'), 'utf8');
      expect(html).toContain('清空');

      const verify = task.nodes.find((n) => n.key === 'final_verify');
      const { body: node } = await live.t.call(getNodeOp, { id: task.id, nodeId: verify?.id ?? '' });
      const check = node.checkResults?.find((c) => c.kind === AcceptanceCheckKind.Browser);
      expect(check).toMatchObject({ passed: true, skipped: false, unrunnable: null });
      expect(check?.kind === AcceptanceCheckKind.Browser && check.pages.map((p) => p.viewport)).toEqual([
        'desktop',
        'mobile',
      ]);
      const { body: sessions } = await live.t.call(listPreviewSessionsOp, { id: task.id });
      expect(sessions.attempts.some((a) => a.frames > 0)).toBe(true);
    },
    TASK_TIMEOUT_MS,
  );
});
