import type { GitReviewDTO } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { reviewSearch, reviewTarget } from './review-location.ts';

const review = (overrides: Partial<GitReviewDTO>): GitReviewDTO => ({
  id: 'r1',
  projectId: 'p1',
  target: 'commit',
  label: 'abc1234',
  from: 'parent2',
  to: 'merge',
  parent: null,
  focus: null,
  files: [],
  status: 'succeeded',
  model: null,
  error: null,
  summary: null,
  findings: [],
  createdAt: 0,
  finishedAt: null,
  ...overrides,
});

describe('审查在工作台中的位置与重新审查的对象（27 §4.2）', () => {
  it('工作区改动的审查在改动视图打开（它没有终点提交，只有那里能显示它的 diff）', () => {
    expect(reviewSearch(review({ target: 'worktree', to: null }))).toEqual({ view: 'changes', tab: 'review' });
  });

  it('合并提交的审查回到同一个父提交：打开时与重新审查时都是', () => {
    const merge = review({ target: 'commit', parent: 2 });
    expect(reviewSearch(merge)).toEqual({ view: 'commits', sha: 'merge', parent: 2, tab: 'review' });
    expect(reviewTarget(merge)).toEqual({ kind: 'commit', sha: 'merge', parent: 2 });
  });

  it('分支与区间的审查在审查视图打开，按原来的对象重来', () => {
    expect(reviewSearch(review({ id: 'r9', target: 'branch', label: 'feature' }))).toEqual({
      view: 'review',
      review: 'r9',
    });
    expect(reviewTarget(review({ target: 'branch', label: 'feature' }))).toEqual({ kind: 'branch', branch: 'feature' });
    expect(reviewTarget(review({ target: 'range', from: 'a', to: 'b' }))).toEqual({
      kind: 'range',
      from: 'a',
      to: 'b',
    });
  });
});
