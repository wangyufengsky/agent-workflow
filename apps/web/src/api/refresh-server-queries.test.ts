import { QueryClient } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import { refreshServerQueries } from './refresh-server-queries.ts';

it('重新同步不会取消没有订阅者的路由预加载，仍将已有缓存标为失效', async () => {
  const client = new QueryClient();
  const initial = Promise.withResolvers<string>();
  client.setQueryData(['cached'], 'before');
  const loader = client.ensureQueryData({ queryKey: ['loader'], queryFn: () => initial.promise });
  try {
    await refreshServerQueries(client);
    expect(client.getQueryState(['cached'])?.isInvalidated).toBe(true);
    initial.resolve('loaded');
    await expect(loader).resolves.toBe('loaded');
  } finally {
    client.clear();
  }
});
