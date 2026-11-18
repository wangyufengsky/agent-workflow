import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createTaskOp,
  getNodeOp,
  getTaskOp,
  listWorkflowsOp,
  requestChangesOp,
  ServerEventType,
  TaskStatus,
  type TranscriptEntry,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { createChromiumHost } from '../packages/server/src/modules/browser/host.chromium.ts';
import { waitForEvent } from '../packages/server/test/helpers/events.ts';
import { startLiveApp, TASK_TIMEOUT_MS } from './live-app.ts';

it(
  '@live 界面修改在 T-11 参数被拒后查阅指引并通过正式工具提交',
  async () => {
    const host = createChromiumHost();
    const live = await startLiveApp('submission-guide', { browserHost: host });
    const { t } = live;
    try {
      const projectId = await live.addProject('todo-web');
      const workflow = (await t.call(listWorkflowsOp, {})).body.items.find((w) => w.key === 'frontend');
      if (!workflow) throw new Error('Missing frontend workflow');
      const untilReview = (id?: string) =>
        waitForEvent(
          t.app.events,
          ServerEventType.TaskUpdated,
          (e) => (!id || id === e.id) && (e.status === TaskStatus.Review || e.status === TaskStatus.Failed),
          TASK_TIMEOUT_MS,
        );
      const first = untilReview();
      const { body: task } = await t.call(createTaskOp, {
        projectId,
        workflowId: workflow.id,
        requirement: '将已有待办网页的主标题改为「待办清单」，保留现有功能。使用浏览器快照核实文字后提交。',
      });
      expect((await first).status).toBe(TaskStatus.Review);
      const revised = untilReview(task.id);
      const { status } = await t.call(requestChangesOp, {
        id: task.id,
        reason: 'user',
        feedback:
          '请在待办清单主标题下面加一行「今日安排从这里开始」。用浏览器快照核对可见文字。本轮同时是提交纠错验收。仅在首次调用正式 submit_result 时模拟旧客户端参数，在真实摘要外带 requirement_results: [] 和 code_review: {scope:{kind:"diff",from:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",to:"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},findings:[]}。收到拒绝后，实际打开错误提示指定的 Skill 和只读指引工具，按返回示例改正并通过正式 MCP 工具提交。',
      });
      expect(status).toBe(200);
      expect((await revised).status).toBe(TaskStatus.Review);
      const detail = (await t.call(getTaskOp, { id: task.id })).body;
      const revision = detail.nodes.find((n) => n.key === 'revise_1');
      if (!revision) throw new Error('Missing revision step');
      const node = (await t.call(getNodeOp, { id: task.id, nodeId: revision.id })).body;
      const attempt = node.attempts.at(-1);
      if (!attempt || !detail.git.worktreePath) throw new Error('Missing revision attempt or worktree');
      expect(await readFile(join(detail.git.worktreePath, 'public/index.html'), 'utf8')).toContain(
        '今日安排从这里开始',
      );
      const file = join(t.dataDir, 'runs', task.id, `${attempt.id}.jsonl`);
      await expect
        .poll(
          async () => {
            const entries: TranscriptEntry[] = (await readFile(file, 'utf8'))
              .trim()
              .split('\n')
              .map((s) => JSON.parse(s));
            const calls = entries.flatMap((e) => (e.kind === 'tool_call' ? [e.data] : []));
            const results = entries.flatMap((e) => (e.kind === 'tool_result' ? [e.data] : []));
            const receipt = (id: string) => {
              const r = results.find((r) => r.callId === id);
              return r?.output ?? r?.error ?? '';
            };
            const rejected = calls.findIndex(
              (c) =>
                c.tool === 'agent-workflow_submit_result' &&
                'requirement_results' in c.input &&
                'code_review' in c.input &&
                receipt(c.callId).includes('REQUIREMENT_RESULTS_INVALID'),
            );
            const lookup = calls.findIndex(
              (c, i) =>
                i > rejected &&
                c.tool === 'agent-workflow_get_submission_guide' &&
                receipt(c.callId).includes('submit_result'),
            );
            const accepted = calls.findIndex(
              (c, i) =>
                i > Math.max(rejected, lookup) &&
                c.tool === 'agent-workflow_submit_result' &&
                !('requirement_results' in c.input) &&
                !('code_review' in c.input) &&
                /"accepted"\s*:\s*true/.test(receipt(c.callId).replaceAll('\\"', '"')),
            );
            return {
              rejected: rejected >= 0,
              guide: rejected >= 0 && lookup > rejected,
              accepted: rejected >= 0 && accepted > rejected,
              skill: calls.some(
                (c, i) =>
                  i > rejected &&
                  i < accepted &&
                  c.tool === 'skill' &&
                  c.input.name === 'aw-submit-result' &&
                  results.some((r) => r.callId === c.callId && r.status === 'completed'),
              ),
              preview: results.some(
                (r) =>
                  [
                    'agent-workflow_browser_snapshot',
                    'agent-workflow_browser_open',
                    'agent-workflow_browser_inspect',
                  ].includes(r.tool) && r.output?.includes('今日安排从这里开始'),
              ),
            };
          },
          { timeout: 15000 },
        )
        .toEqual({ rejected: true, guide: true, accepted: true, skill: true, preview: true });
    } finally {
      await live.close();
      await host.close();
    }
  },
  2 * TASK_TIMEOUT_MS + 120000,
);
