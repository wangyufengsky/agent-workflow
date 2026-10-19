import { getEnvironmentOp, recheckEnvironmentOp } from '@aw/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';

export const environmentQuery = queryOptions({
  queryKey: queryKeys.environment,
  queryFn: () => callOperation(getEnvironmentOp, {}),
});

export function useRecheckEnvironment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => callOperation(recheckEnvironmentOp, {}),
    onSuccess: (environment) => queryClient.setQueryData(queryKeys.environment, environment),
  });
}
