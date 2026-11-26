import { AttemptStatus } from '@aw/shared';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import { gitReviewQuery, gitReviewsQuery, refreshGitReview } from './git.queries.ts';

it('审查提交事件在首次读取尚未返回时刷新报告详情和列表', async () => {
  const client = new QueryClient();
  const projectId = 'project';
  const reviewId = 'review';
  const keys = [gitReviewQuery(reviewId).queryKey, gitReviewsQuery(projectId).queryKey];
  const initial = keys.map(() => Promise.withResolvers<AttemptStatus>());
  const observers = keys.map((queryKey, index) => {
    const pending = initial[index];
    if (pending === undefined) throw new Error('Missing initial read');
    let first = true;
    return new QueryObserver(client, {
      queryKey,
      queryFn: () => {
        if (!first) return Promise.resolve(AttemptStatus.Succeeded);
        first = false;
        return pending.promise;
      },
    });
  });
  const subscriptions = observers.map((observer) => observer.subscribe(() => {}));
  try {
    const refreshed = refreshGitReview(client, projectId, reviewId);
    for (const pending of initial) pending.resolve(AttemptStatus.Running);
    await refreshed;
    expect(keys.map((key) => client.getQueryData(key))).toEqual([AttemptStatus.Succeeded, AttemptStatus.Succeeded]);
  } finally {
    for (const unsubscribe of subscriptions) unsubscribe();
    client.clear();
  }
});
