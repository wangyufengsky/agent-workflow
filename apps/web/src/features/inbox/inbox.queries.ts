import {
  BLOCKING_INBOX_KINDS,
  countInboxOp,
  dismissInboxOp,
  type InboxItemDTO,
  type InboxStatus,
  listInboxOp,
  resolveInboxOp,
} from '@aw/shared';
import {
  infiniteQueryOptions,
  type QueryClient,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type { z } from 'zod';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';

export type InboxFilter = { status?: InboxStatus; taskId?: string };

export const inboxQuery = (filter: InboxFilter) =>
  queryOptions({
    queryKey: queryKeys.inboxList(filter),
    queryFn: async () => (await callOperation(listInboxOp, { ...filter })).items,
  });

/** The first page is asked for without a cursor. */
const FIRST_PAGE = '';

/** Every loaded page (11 §1 pagination), for the inbox page's「加载更多」. */
export const inboxPagesQuery = (filter: InboxFilter) =>
  infiniteQueryOptions({
    queryKey: queryKeys.inboxPages(filter),
    queryFn: ({ pageParam }) =>
      callOperation(listInboxOp, { ...filter, ...(pageParam === FIRST_PAGE ? {} : { cursor: pageParam }) }),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const inboxCountQuery = queryOptions({
  queryKey: queryKeys.inboxCount,
  queryFn: async () => (await callOperation(countInboxOp, {})).blocking,
});

/** SSE `inbox.updated`: the badge count comes with the event; lists refetch. */
export async function updateInbox(qc: QueryClient, blockingCount: number): Promise<void> {
  qc.setQueryData(queryKeys.inboxCount, blockingCount);
  await qc.invalidateQueries({ queryKey: [...queryKeys.inbox, 'list'] });
}

/** Resolving or dismissing changes the item, its task and possibly its node; their SSE events refresh the rest. */
function useInboxMutation<I>(run: (input: I) => Promise<InboxItemDTO>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async (item) => {
      if (item.taskId !== null) await queryClient.invalidateQueries({ queryKey: queryKeys.task(item.taskId) });
    },
  });
}

export type InboxResponse = z.input<typeof resolveInboxOp.input>['response'];

export const useResolveInbox = () =>
  useInboxMutation((input: { id: string; response: InboxResponse }) => callOperation(resolveInboxOp, input));
export const useDismissInbox = () => useInboxMutation((id: string) => callOperation(dismissInboxOp, { id }));

/**
 * Items that hold something up until the user acts, apart from results waiting to be merged (D119): those are listed
 * after them and not counted.
 */
export function splitInbox(items: readonly InboxItemDTO[]): { blocking: InboxItemDTO[]; deliveries: InboxItemDTO[] } {
  const blocking = items.filter((item) => BLOCKING_INBOX_KINDS.includes(item.kind));
  return { blocking, deliveries: items.filter((item) => !BLOCKING_INBOX_KINDS.includes(item.kind)) };
}
