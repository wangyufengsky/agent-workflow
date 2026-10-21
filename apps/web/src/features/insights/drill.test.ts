import type { InsightsTaskDTO } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { drillFilter, failureKey } from './drill.ts';

const row = (id: string, over: Partial<InsightsTaskDTO> = {}): InsightsTaskDTO => ({
  task: {
    id,
    key: id,
    title: id,
    status: 'completed',
    displayGroup: 'completed',
    project: { id: 'p1', name: 'P' },
    workflow: { id: 'w1', key: 'feature', name: 'F' },
    currentStep: null,
    progress: null,
    createdAt: 0,
    updatedAt: 0,
    startedAt: 0,
    finishedAt: 0,
  },
  usage: { attempts: 1, tokensInput: 1, tokensOutput: 1, cost: 0, unpricedTokens: 2 },
  roles: ['developer'],
  models: [null],
  kinds: ['execute'],
  quality: {
    endedAt: 0,
    doneNodes: 2,
    firstPassNodes: 2,
    retries: 0,
    interruptions: 0,
    failureReasons: [],
    reviewDurationMs: 1000,
  },
  ...over,
});

const ids = (rows: InsightsTaskDTO[], drill: Parameters<typeof drillFilter>[0], key: string | null = null) =>
  rows.filter(drillFilter(drill, key)).map((r) => r.task.id);

describe('drillFilter', () => {
  const timeout = { kind: 'attempt_error', code: 'ATTEMPT_TIMEOUT', count: 1 } as const;
  const rows = [
    row('clean'),
    row('retried', {
      quality: {
        endedAt: 0,
        doneNodes: 2,
        firstPassNodes: 1,
        retries: 1,
        interruptions: 2,
        failureReasons: [timeout],
        reviewDurationMs: null,
      },
    }),
    row('cancelled', { task: { ...row('x').task, id: 'cancelled', status: 'cancelled' } }),
    // Used AI in the period without ending in it: only usage drill-downs show it.
    row('running', {
      quality: null,
      roles: ['reviewer'],
      models: ['p/m'],
      kinds: ['review'],
      task: { ...row('x').task, id: 'running', status: 'running', project: { id: 'p2', name: 'Q' } },
    }),
  ];

  it('结束状态、首次未通过、重试、打扰、到待合并只看结束的任务', () => {
    expect(ids(rows, 'completed')).toEqual(['clean', 'retried']);
    expect(ids(rows, 'cancelled')).toEqual(['cancelled']);
    expect(ids(rows, 'first_pass_missed')).toEqual(['retried']);
    expect(ids(rows, 'retried')).toEqual(['retried']);
    expect(ids(rows, 'interrupted')).toEqual(['retried']);
    expect(ids(rows, 'review_duration')).toEqual(['clean', 'cancelled']);
  });

  it('失败原因按「类别:错误码」匹配', () => {
    expect(failureKey(timeout)).toBe('attempt_error:ATTEMPT_TIMEOUT');
    expect(ids(rows, 'failure', 'attempt_error:ATTEMPT_TIMEOUT')).toEqual(['retried']);
    expect(ids(rows, 'failure', 'checks_failed:')).toEqual([]);
  });

  it('拆分：项目、流程、角色、模型（空键为默认模型）、用途', () => {
    expect(ids(rows, 'project', 'p2')).toEqual(['running']);
    expect(ids(rows, 'workflow', 'feature')).toEqual(['clean', 'retried', 'cancelled', 'running']);
    expect(ids(rows, 'role', 'reviewer')).toEqual(['running']);
    expect(ids(rows, 'model', null)).toEqual(['clean', 'retried', 'cancelled']);
    expect(ids(rows, 'kind', 'review')).toEqual(['running']);
  });
});
