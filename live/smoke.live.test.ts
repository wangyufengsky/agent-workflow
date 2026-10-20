import { join } from 'node:path';
import { TaskStatus } from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runGit } from '../packages/server/src/modules/git/index.ts';
import { type LiveApp, outcome, startLiveApp, TASK_TIMEOUT_MS } from './live-app.ts';

/**
 * M3-12 live smoke (07 §6): the built-in bugfix and feature workflows on ts-stats with the real opencode and the
 * free test model. Run by hand: `pnpm test:live` (AW_OC_TEST_MODEL overrides the model).
 */
let live: LiveApp;
beforeAll(async () => {
  live = await startLiveApp('smoke');
}, 120_000);
afterAll(() => live.close());

describe('@live 内置流程冒烟', () => {
  it(
    'bugfix：修复 median 的排序缺陷',
    async () => {
      const task = await live.runTask(
        'bugfix',
        'ts-stats',
        'median 返回了错误的结果：median([10, 9, 1]) 应该是 9，实际是 10。请找到原因并修复。',
      );
      // A failed phase (model unavailable, session error …) shows its code and message here.
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.result?.checks.every((c) => c.passed)).toBe(true);
      const worktree = task.git.worktreePath ?? '';
      const { stdout } = await runGit(['log', '--format=%an', `${task.git.baseCommit}..HEAD`], { cwd: worktree });
      expect(stdout).toContain('agent-workflow');
      const probe = await import(join(worktree, 'src/stats.ts'));
      expect(probe.median([10, 9, 1])).toBe(9);
    },
    TASK_TIMEOUT_MS,
  );

  it(
    'feature：新增 percentile',
    async () => {
      const task = await live.runTask(
        'feature',
        'ts-stats',
        '新增函数 percentile(values: number[], p: number): number，返回第 p 百分位数（p 取 0 到 100，线性插值），放在 src/stats.ts，并补充测试。',
      );
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.result?.filesChanged).toBeGreaterThan(0);
      expect(task.result?.checks.every((c) => c.passed)).toBe(true);
    },
    TASK_TIMEOUT_MS,
  );
});
