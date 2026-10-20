import {
  type CreateDbConnectionRequest,
  createDbConnectionOp,
  dbSchemaOp,
  deleteDbConnectionOp,
  listDbConnectionsOp,
  setProjectDbConnectionsOp,
  testDbConnectionOp,
  type UpdateDbConnectionRequest,
  updateDbConnectionOp,
} from '@aw/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';

export const dbConnectionsQuery = queryOptions({
  queryKey: queryKeys.dbConnections,
  queryFn: async () => (await callOperation(listDbConnectionsOp, {})).items,
});

export const dbSchemaQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.dbSchema(id), queryFn: () => callOperation(dbSchemaOp, { id }) });

function useConnectionsMutation<I, O>(run: (input: I) => Promise<O>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    // Projects show their linked connections too.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.dbConnections }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
      ]),
  });
}

export const useCreateDbConnection = () =>
  useConnectionsMutation((input: CreateDbConnectionRequest) => callOperation(createDbConnectionOp, input));
export const useUpdateDbConnection = () =>
  useConnectionsMutation((input: UpdateDbConnectionRequest) => callOperation(updateDbConnectionOp, input));
export const useDeleteDbConnection = () =>
  useConnectionsMutation((id: string) => callOperation(deleteDbConnectionOp, { id }));

/** The result belongs to the button that asked, not to the cache. */
export const useTestDbConnection = () =>
  useMutation({ mutationFn: (id: string) => callOperation(testDbConnectionOp, { id }) });

export function useSetProjectDbConnections() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; connectionIds: string[] }) => callOperation(setProjectDbConnectionsOp, input),
    onSuccess: (project) => queryClient.setQueryData(queryKeys.project(project.id), project),
  });
}
