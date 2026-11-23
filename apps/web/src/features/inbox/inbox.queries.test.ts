import { InboxStatus } from '@aw/shared';
import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import { queryKeys } from '../../api/query-keys.ts';
import { updateInbox } from './inbox.queries.ts';

it('首次收件箱快照加载途中收到事件，列表仍可见同时到达的权限卡', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queryKey = queryKeys.inboxPages({ status: InboxStatus.Open, blocking: true });
  const before = { items: ['permission-1', 'permission-2'], nextCursor: null };
  const after = { items: [...before.items, 'permission-3'], nextCursor: null };
  const firstStarted = Promise.withResolvers<void>();
  const firstResponse = Promise.withResolvers<typeof before>();
  let firstRead = true;
  const observer = new InfiniteQueryObserver(client, {
    queryKey,
    queryFn: async () => {
      if (!firstRead) return after;
      firstRead = false;
      firstStarted.resolve();
      return firstResponse.promise;
    },
    initialPageParam: '',
    getNextPageParam: (page) => page.nextCursor,
  });

  const unsubscribe = observer.subscribe(() => {});
  try {
    await firstStarted.promise;
    const updated = updateInbox(client, 3);
    firstResponse.resolve(before);
    await updated;
    expect(observer.getCurrentResult().data?.pages[0]?.items).toEqual(after.items);
  } finally {
    unsubscribe();
    client.clear();
  }
});
