import { insightsQuerySchema } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { aggregateInsights, type EndedTask, type InsightsData, type UsageAttempt } from './insights.aggregate.ts';
import { resolvePeriod } from './insights.period.ts';

const ZONE = 'Asia/Shanghai';
// 2026-01-07 10:00 in Shanghai; the period is 2026-01-05 … 2026-01-07.
const NOW = Date.parse('2026-01-07T02:00:00Z');
const period = resolvePeriod(
  insightsQuerySchema.parse({ period: 'custom', from: '2026-01-05', to: '2026-01-07' }),
  NOW,
  ZONE,
);
/** `HH:mm` on a day of January 2026, Shanghai time. */
const at = (day: number, time = '12:00') => Date.parse(`2026-01-${String(day).padStart(2, '0')}T${time}:00+08:00`);

const empty: InsightsData = { usage: [], ended: [], nodes: [], executeAttempts: [], nodeEvents: [], interruptions: [] };

const attempt = (over: Partial<UsageAttempt> = {}): UsageAttempt => ({
  taskId: 't1',
  kind: 'execute',
  roleKey: 'developer',
  roleName: '开发者',
  model: 'p/m',
  tokensInput: 100,
  tokensOutput: 10,
  startedAt: at(6),
  projectId: 'p1',
  projectName: '商城',
  workflowKey: 'feature',
  workflowName: '新功能',
  ...over,
});

const ended = (over: Partial<EndedTask> & { id: string }): EndedTask => ({
  status: 'completed',
  endedAt: at(6),
  startedAt: at(6, '09:00'),
  reviewAt: at(6, '10:00'),
  ...over,
});

describe('aggregateInsights', () => {
  it('没有数据：合计为 0、比率与中位数为空、每一天都有点', () => {
    const { summary, tasks } = aggregateInsights(period, empty);
    expect(summary.usage).toMatchObject({ attempts: 0, tokensInput: 0, tokensOutput: 0 });
    expect(summary.usage.groups.project).toEqual([]);
    expect(summary.days.map((d) => [d.date, d.tokensInput, d.tasksCompleted])).toEqual([
      ['2026-01-05', 0, 0],
      ['2026-01-06', 0, 0],
      ['2026-01-07', 0, 0],
    ]);
    expect(summary.quality).toMatchObject({
      completionRate: null,
      firstPassRate: null,
      avgRetries: null,
      avgInterruptions: null,
      reviewDurationMedianMs: null,
      failureReasons: [],
    });
    expect(tasks).toEqual([]);
  });

  it('没有报告用量的尝试只计次数；拆分按 tokens 降序，模型的空键为 opencode 默认模型', () => {
    const { summary } = aggregateInsights(period, {
      ...empty,
      usage: [
        attempt({ model: 'p/small' }),
        attempt({ model: 'p/large', tokensInput: 900, tokensOutput: 90 }),
        attempt({ model: null, tokensInput: null, tokensOutput: null }),
      ],
    });
    expect(summary.usage).toMatchObject({ attempts: 3, tokensInput: 1000, tokensOutput: 100 });
    expect(summary.usage.groups.model.map((g) => [g.key, g.tokensInput, g.attempts])).toEqual([
      ['p/large', 900, 1],
      ['p/small', 100, 1],
      [null, 0, 1],
    ]);
  });

  it('用量按尝试开始时所在时区的日期归入每一天', () => {
    const { summary } = aggregateInsights(period, {
      ...empty,
      // 2026-01-05 23:30 in Shanghai is still the 5th there (15:30 UTC).
      usage: [
        attempt({ startedAt: at(5, '23:30'), tokensInput: 1 }),
        attempt({ startedAt: at(6, '00:10'), tokensInput: 2 }),
      ],
    });
    expect(summary.days.map((d) => d.tokensInput)).toEqual([1, 2, 0]);
  });

  it('拆分：知识问答的尝试没有流程与角色（空键），同一流程合并', () => {
    const { summary } = aggregateInsights(period, {
      ...empty,
      usage: [
        attempt(),
        attempt({ kind: 'review', roleKey: 'reviewer', roleName: '评审员' }),
        attempt({
          taskId: null,
          kind: 'research',
          roleKey: null,
          roleName: null,
          workflowKey: null,
          workflowName: null,
          tokensInput: 300,
        }),
      ],
    });
    const keys = (d: keyof typeof summary.usage.groups) => summary.usage.groups[d].map((g) => [g.key, g.attempts]);
    expect(keys('workflow')).toEqual([
      [null, 1],
      ['feature', 2],
    ]);
    expect(keys('role')).toEqual([
      [null, 1],
      ['developer', 1],
      ['reviewer', 1],
    ]);
    expect(keys('kind')).toEqual([
      ['research', 1],
      ['execute', 1],
      ['review', 1],
    ]);
    expect(keys('project')).toEqual([['p1', 3]]);
  });

  it('质量：完成率、首次通过不计中断的尝试、重试含失败的步骤', () => {
    const { summary, tasks } = aggregateInsights(period, {
      ...empty,
      ended: [ended({ id: 't1' }), ended({ id: 't2', status: 'cancelled' }), ended({ id: 't3', status: 'failed' })],
      nodes: [
        { id: 'n1', taskId: 't1', status: 'done' },
        { id: 'n2', taskId: 't1', status: 'done' },
        { id: 'n3', taskId: 't3', status: 'failed' },
        { id: 'n4', taskId: 't2', status: 'cancelled' },
      ],
      executeAttempts: [
        // n1: interrupted once, then passed: still a first pass.
        { taskId: 't1', nodeId: 'n1', status: 'interrupted', errorCode: null },
        { taskId: 't1', nodeId: 'n1', status: 'succeeded', errorCode: null },
        // n2: failed checks once, passed on the second attempt.
        { taskId: 't1', nodeId: 'n2', status: 'succeeded', errorCode: null },
        { taskId: 't1', nodeId: 'n2', status: 'succeeded', errorCode: null },
        // n3: three failed attempts.
        { taskId: 't3', nodeId: 'n3', status: 'failed', errorCode: 'ATTEMPT_TIMEOUT' },
        { taskId: 't3', nodeId: 'n3', status: 'failed', errorCode: 'ATTEMPT_TIMEOUT' },
        { taskId: 't3', nodeId: 'n3', status: 'failed', errorCode: 'ATTEMPT_NO_RESULT' },
        { taskId: 't2', nodeId: 'n4', status: 'aborted', errorCode: null },
      ],
      nodeEvents: [
        { taskId: 't1', type: 'checks_failed' },
        { taskId: 't1', type: 'dispatch' },
      ],
    });
    expect(summary.quality).toMatchObject({
      ended: { completed: 1, cancelled: 1, failed: 1 },
      doneNodes: 2,
      firstPassNodes: 1,
      firstPassRate: 0.5,
      finishedNodes: 3,
      retries: 3,
      avgRetries: 1,
      failureReasons: [
        { kind: 'attempt_error', code: 'ATTEMPT_TIMEOUT', count: 2 },
        { kind: 'attempt_error', code: 'ATTEMPT_NO_RESULT', count: 1 },
        { kind: 'checks_failed', code: null, count: 1 },
      ],
    });
    expect(summary.quality.completionRate).toBeCloseTo(1 / 3);
    expect(tasks.find((t) => t.taskId === 't1')?.quality).toMatchObject({
      doneNodes: 2,
      firstPassNodes: 1,
      retries: 1,
    });
  });

  it('打扰：不含按默认假设记录的提问；时间段内创建的另计为 attention，不限于结束的任务', () => {
    const { summary, tasks } = aggregateInsights(period, {
      ...empty,
      ended: [ended({ id: 't1' })],
      interruptions: [
        { taskId: 't1', createdAt: at(1), assumed: false },
        { taskId: 't1', createdAt: at(6), assumed: true },
        { taskId: 't1', createdAt: at(6), assumed: false },
        { taskId: null, createdAt: at(7), assumed: false },
      ],
    });
    expect(summary.quality).toMatchObject({ interruptions: 2, avgInterruptions: 2 });
    expect(summary.attention.interruptions).toBe(2);
    expect(tasks[0]?.quality?.interruptions).toBe(2);
  });

  it('到待合并耗时：已完成任务的中位数；当天完成的任务数进入趋势', () => {
    const hour = 3_600_000;
    const { summary } = aggregateInsights(period, {
      ...empty,
      ended: [
        ended({ id: 't1', startedAt: at(5, '08:00'), reviewAt: at(5, '09:00'), endedAt: at(5) }),
        ended({ id: 't2', startedAt: at(6, '08:00'), reviewAt: at(6, '11:00'), endedAt: at(6) }),
        ended({ id: 't3', startedAt: at(6, '08:00'), reviewAt: at(6, '13:00'), endedAt: at(7) }),
        ended({ id: 't4', status: 'cancelled', startedAt: at(6, '08:00'), reviewAt: at(7, '08:00') }),
      ],
    });
    expect(summary.quality.reviewDurationMedianMs).toBe(3 * hour);
    expect(summary.days.map((d) => d.tasksCompleted)).toEqual([1, 1, 1]);
  });

  it('任务明细：结束的任务与有用量的任务，用量只算本时间段的，没结束的没有质量', () => {
    const { tasks } = aggregateInsights(period, {
      ...empty,
      usage: [
        attempt({ taskId: 't2', model: 'p/a' }),
        attempt({ taskId: 't2', model: 'p/b', kind: 'review', roleKey: 'reviewer' }),
        attempt({ taskId: null, kind: 'research' }),
      ],
      ended: [ended({ id: 't1' })],
    });
    expect(tasks).toEqual([
      expect.objectContaining({
        taskId: 't1',
        usage: expect.objectContaining({ attempts: 0 }),
        quality: expect.anything(),
      }),
      expect.objectContaining({
        taskId: 't2',
        usage: expect.objectContaining({ attempts: 2, tokensInput: 200 }),
        roles: ['developer', 'reviewer'],
        models: ['p/a', 'p/b'],
        kinds: ['execute', 'review'],
        quality: null,
      }),
    ]);
  });
});
