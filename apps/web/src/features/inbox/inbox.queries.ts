import {
  countInboxOp,
  dismissInboxOp,
  type InboxItemDTO,
  type InboxStatus,
  listInboxOp,
  resolveInboxOp,
} from '@aw/shared';
import { type QueryClient, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';

export type InboxFilter = { status?: InboxStatus; taskId?: string };

export const inboxQuery = (filter: InboxFilter) =>
  queryOptions({
    queryKey: queryKeys.inboxList(filter),
    queryFn: async () => (await callOperation(listInboxOp, { ...filter })).items,
  });

export const inboxCountQuery = queryOptions({
  queryKey: queryKeys.inboxCount,
  queryFn: async () => (await callOperation(countInboxOp, {})).open,
});

/** SSE `inbox.updated`: the badge count comes with the event; lists refetch. */
export async function updateInbox(qc: QueryClient, openCount: number): Promise<void> {
  qc.setQueryData(queryKeys.inboxCount, openCount);
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
