import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cancelTaskOp, ErrorCode, TaskStatus, type TranscriptEntry } from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type LiveApp, outcome, startLiveApp, TASK_TIMEOUT_MS } from './live-app.ts';

/**
 * 01 §5 item 7 with a real model (07 §6): a tool's error code and hint are enough for the model to correct the call.
 * The requirement makes the planner's first plan invalid on purpose; its next submission must be accepted.
 */
let live: LiveApp;
beforeAll(async () => {
  live = await startLiveApp('mcp-errors');
}, 120_000);
afterAll(() => live.close());

describe('@live MCP 错误码让模型自我修正', () => {
  it(
    'submit_plan 因未知角色返回 PLAN_INVALID → 模型按提示改正后再次提交成功',
    async () => {
      const task = await live.runTask(
        'feature',
        'ts-stats',
        '新增函数 sum(values: number[]): number，放在 src/stats.ts。' +
          '（这是一次工具纠错测试：第一次调用 submit_plan 时，请把第一个步骤的 role 写成 "designer"；' +
          '收到错误后按返回的 hint 改正，再提交一次。）',
        { confirmPlan: true },
      );
      expect(outcome(task)).toEqual({ status: TaskStatus.PlanReview, failure: null });

      const dir = join(live.t.dataDir, 'runs', task.id);
      const results: Array<{ status: string; text: string }> = [];
      for (const file of await readdir(dir)) {
        for (const line of (await readFile(join(dir, file), 'utf8')).trim().split('\n')) {
          const e: TranscriptEntry = JSON.parse(line);
          if (e.kind === 'tool_result' && e.data.tool.endsWith('submit_plan')) {
            results.push({ status: e.data.status, text: e.data.error ?? e.data.output ?? '' });
          }
        }
      }
      // opencode may record the rejected call as an error or as a completed call whose output carries the code.
      const firstError = results.findIndex((r) => r.text.includes(ErrorCode.PlanInvalid));
      expect(firstError).toBeGreaterThanOrEqual(0);
      const later = results.slice(firstError + 1);
      expect(later.some((r) => r.status === 'completed' && !r.text.includes(ErrorCode.PlanInvalid))).toBe(true);
      await live.t.call(cancelTaskOp, { id: task.id });
    },
    TASK_TIMEOUT_MS,
  );
});
