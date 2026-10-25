import {
  cleanStorageOp,
  getHealthOp,
  getRuntimeLogsOp,
  getRuntimeOp,
  getStorageOp,
  listMcpToolsOp,
  restartRuntimeOp,
  type StorageCleanTarget,
} from '@aw/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';

/** Kept current by `runtime.updated` (api/server-events.ts). */
export const runtimeQuery = queryOptions({
  queryKey: queryKeys.runtime,
  queryFn: () => callOperation(getRuntimeOp, {}),
});

export function useRestartRuntime() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => callOperation(restartRuntimeOp, {}),
    onSuccess: (runtime) => queryClient.setQueryData(queryKeys.runtime, runtime),
  });
}

/** The end of the opencode log (M5-08); refreshed on demand. */
export const runtimeLogsQuery = (tail: number) =>
  queryOptions({ queryKey: queryKeys.runtimeLogs(tail), queryFn: () => callOperation(getRuntimeLogsOp, { tail }) });

/** The backend's version, which is the app's (AW_APP_VERSION from the desktop package). */
export const healthQuery = queryOptions({
  queryKey: queryKeys.health,
  queryFn: () => callOperation(getHealthOp, {}),
  staleTime: Number.POSITIVE_INFINITY,
});

export const mcpToolsQuery = queryOptions({
  queryKey: queryKeys.mcpTools,
  queryFn: async () => (await callOperation(listMcpToolsOp, {})).items,
  staleTime: Number.POSITIVE_INFINITY,
});

/** Disk usage (37); measured when the panel opens and on demand, not kept fresh by events. */
export const storageQuery = queryOptions({
  queryKey: queryKeys.storage,
  queryFn: () => callOperation(getStorageOp, {}),
  staleTime: Number.POSITIVE_INFINITY,
});

export function useCleanStorage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (target: StorageCleanTarget) => callOperation(cleanStorageOp, { target }),
    onSuccess: ({ storage }) => queryClient.setQueryData(queryKeys.storage, storage),
  });
}
