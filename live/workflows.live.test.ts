import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TaskStatus } from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type LiveApp, outcome, startLiveApp, TASK_TIMEOUT_MS } from './live-app.ts';

/**
 * M6-05 live suite (07 §6): with smoke.live.test.ts every built-in workflow runs once; the Java fixture runs its
 * check with Maven. Run by hand: `pnpm test:live`.
 */
let live: LiveApp;
beforeAll(async () => {
  live = await startLiveApp('workflows');
}, 120_000);
afterAll(() => live.close());

describe('@live 内置流程全集', () => {
  it(
    'bugfix（Java / Maven）：lowStock 漏掉了等于阈值的商品',
    async () => {
      const task = await live.runTask(
        'bugfix',
        'java-inventory',
        'Inventory.lowStock(threshold) 应返回库存小于等于阈值的商品，但库存正好等于阈值的商品没有被列出。请找到原因并修复。',
      );
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.result?.checks.every((c) => c.passed)).toBe(true);
      const source = await readFile(
        join(task.git.worktreePath ?? '', 'src/main/java/inventory/Inventory.java'),
        'utf8',
      );
      expect(source).toContain('<= threshold');
    },
    TASK_TIMEOUT_MS,
  );

  it(
    'unit_tests：为 average 补单元测试',
    async () => {
      const task = await live.runTask(
        'unit_tests',
        'ts-stats',
        '为 src/stats.ts 中的 average 补充单元测试，覆盖普通输入与只有一个元素的输入。',
      );
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.result?.files.some((f) => f.path.startsWith('test/'))).toBe(true);
      expect(task.result?.checks.every((c) => c.passed)).toBe(true);
    },
    TASK_TIMEOUT_MS,
  );

  it(
    'code_review（Java）：审查 Inventory，只出报告不改代码',
    async () => {
      const task = await live.runTask('code_review', 'java-inventory', '审查 src/main/java/inventory/Inventory.java。');
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.result?.filesChanged).toBe(0);
      expect(task.result?.summary.length).toBeGreaterThan(0);
    },
    TASK_TIMEOUT_MS,
  );

  it(
    'refactor（Java / Maven）：提取重复的数量校验，行为不变',
    async () => {
      const task = await live.runTask(
        'refactor',
        'java-inventory',
        'Inventory 的 add 与 remove 中重复了「quantity 必须为正数」的校验，把它提取为一个私有方法，外部行为保持不变。',
      );
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.result?.filesChanged).toBeGreaterThan(0);
      expect(task.result?.checks.every((c) => c.passed)).toBe(true);
    },
    TASK_TIMEOUT_MS,
  );
});
