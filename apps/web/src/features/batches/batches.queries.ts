import {
  type CreateBatchRequest,
  createBatchOp,
  type DeliverBatchRequest,
  deliverBatchOp,
  getBatchOp,
  listBatchesOp,
} from '@aw/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';

export type BatchFilter = { projectId?: string };

export const batchesQuery = (filter: BatchFilter = {}) =>
  queryOptions({
    queryKey: queryKeys.batches(filter),
    queryFn: async () => (await callOperation(listBatchesOp, { ...filter })).items,
  });

export const batchQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.batch(id), queryFn: () => callOperation(getBatchOp, { id }) });

/** The batch's tasks are new: task lists (and the batches under their prefix) refetch. */
export function useCreateBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBatchRequest) => callOperation(createBatchOp, input),
    onSuccess: async (batch) => {
      queryClient.setQueryData(queryKeys.batch(batch.id), batch);
      await queryClient.invalidateQueries({ queryKey: queryKeys.taskLists });
    },
  });
}

export function useDeliverBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DeliverBatchRequest) => callOperation(deliverBatchOp, input),
    onSuccess: ({ batch }) => queryClient.setQueryData(queryKeys.batch(batch.id), batch),
  });
}
