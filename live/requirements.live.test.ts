import { getRequirementsOp, TaskStatus } from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type LiveApp, outcome, startLiveApp, TASK_TIMEOUT_MS } from './live-app.ts';

/**
 * Q-03 (31 §7): a real model works a task with an acceptance checklist; its last step concludes each item. The free
 * test model; run by hand with `pnpm test:live`.
 */
let live: LiveApp;
beforeAll(async () => {
  live = await startLiveApp('requirements');
}, 120_000);
afterAll(() => live.close());

describe('@live 需求验收清单', () => {
  it(
    'bugfix：median 按字符串排序；核验步骤对 AI 项给出有依据的结论，命令项由后端运行，人工项留给用户',
    async () => {
      const task = await live.runTask(
        'bugfix',
        'ts-stats',
        'src/stats.ts 的 median([10, 9, 2]) 返回 2，应该返回 9。请找到原因并修复。',
        {
          requirements: [
            { title: 'median 按数值取中位数', expected: 'median([10, 9, 2]) 返回 9，median([3, 1, 2, 10]) 返回 2.5' },
            {
              title: '单元测试通过',
              expected: 'node --test 退出码 0',
              verification: { kind: 'command', command: 'node --test' },
            },
            { title: '说明清楚', expected: '修复说明讲清了原因', required: false, verification: { kind: 'manual' } },
          ],
        },
      );
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.nodes.at(-1)).toMatchObject({ kind: 'verify', status: 'done' });

      const { body: view } = await live.t.call(getRequirementsOp, { id: task.id });
      const [byAi, byCommand, byUser] = view.items;
      // The AI's conclusion is its own, with what it is based on.
      expect(byAi).toMatchObject({ status: 'passed', latest: { source: 'ai' } });
      expect(byAi?.latest?.note.length).toBeGreaterThan(10);
      expect(byCommand).toMatchObject({ status: 'passed', latest: { source: 'command' } });
      expect(byUser).toMatchObject({ status: 'unverified', latest: null });
    },
    TASK_TIMEOUT_MS,
  );
});
