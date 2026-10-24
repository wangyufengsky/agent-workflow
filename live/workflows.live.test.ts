import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TaskStatus } from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type LiveApp, outcome, startLiveApp, TASK_TIMEOUT_MS } from './live-app.ts';

/**
 * M6-05 live suite (07 §6): with smoke.live.test.ts every built-in workflow runs once; the Java fixture runs its
 * check with Maven. Run by hand: `pnpm test:live`.
 */
/** ts-stats as of 2026-09-25, plus `percentile` added on 2026-10-05 with an off-by-one index and an unused helper. */
const STATS_HISTORY = {
  initAt: '2026-09-25T10:00:00',
  commits: [
    {
      date: '2026-10-05T10:00:00',
      message: 'add percentile',
      files: {
        'src/percentile.ts': [
          '/** The value below which `p` percent of the values fall (nearest rank). */',
          'export function percentile(values: readonly number[], p: number): number {',
          '  const sorted = [...values].sort((a, b) => a - b);',
          '  return sorted[Math.ceil((p / 100) * sorted.length)];',
          '}',
          '',
          'function clamp(value: number, low: number, high: number): number {',
          '  return Math.min(Math.max(value, low), high);',
          '}',
          '',
        ].join('\n'),
      },
    },
  ],
};

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

  it(
    'version_review：审查 10 月 1 日以来新增的 percentile（median 的排序问题在那之前就有）',
    async () => {
      const task = await live.runTask(
        'version_review',
        'ts-stats',
        '对比 main 分支 2026-10-01 的版本，审查之后新增的代码。',
        { history: STATS_HISTORY },
      );
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.result?.filesChanged).toBe(0);
      expect(task.result?.summary).toContain('percentile');
    },
    TASK_TIMEOUT_MS,
  );

  it(
    'security_review：静态服务器的路径穿越',
    async () => {
      const task = await live.runTask('security_review', 'todo-web', '审查 server.mjs 的安全问题。');
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.result?.filesChanged).toBe(0);
      expect(task.result?.summary).toContain('server.mjs');
    },
    TASK_TIMEOUT_MS,
  );

  it(
    'cleanup：删除没有被使用的 clamp，保留导出的 percentile，检查通过',
    async () => {
      const task = await live.runTask('cleanup', 'ts-stats', '清理 src 目录中没有被使用的代码。', {
        history: STATS_HISTORY,
      });
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.result?.checks.every((c) => c.passed)).toBe(true);
      const source = await readFile(join(task.git.worktreePath ?? '', 'src/percentile.ts'), 'utf8');
      expect(source).not.toContain('clamp');
      expect(source).toContain('export function percentile');
    },
    TASK_TIMEOUT_MS,
  );

  it(
    'design_proposal（Java）：按类别统计库存，只出方案不改代码',
    async () => {
      const task = await live.runTask(
        'design_proposal',
        'java-inventory',
        '想给 Inventory 增加按商品类别统计库存总量的功能，请给出设计方案。',
      );
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.result?.filesChanged).toBe(0);
      expect(task.result?.summary).toContain('Inventory');
    },
    TASK_TIMEOUT_MS,
  );

  it(
    'detailed_design（Java）：写设计文档，不改代码',
    async () => {
      const task = await live.runTask(
        'detailed_design',
        'java-inventory',
        '为 Inventory 增加按商品类别统计库存总量的功能，写一份详细设计。',
      );
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.result?.files.some((f) => f.path.endsWith('.md'))).toBe(true);
      expect(task.result?.files.some((f) => f.path.endsWith('.java'))).toBe(false);
    },
    TASK_TIMEOUT_MS,
  );
});
