import { getRuntimeOp, restartRuntimeOp } from '@aw/shared';
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
