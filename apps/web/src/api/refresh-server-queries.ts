import type { QueryClient, QueryKey } from '@tanstack/react-query';

/** 事件可能早于首次读取完成。先结束受影响的活跃首读，避免失效操作复用旧请求。 */
export async function refreshServerQueries(client: QueryClient, queryKey?: QueryKey): Promise<void> {
  const filter = queryKey === undefined ? {} : { queryKey };
  await client.cancelQueries({
    ...filter,
    type: 'active',
    predicate: ({ state }) => state.data === undefined && state.fetchStatus === 'fetching',
  });
  await client.invalidateQueries(filter);
}
