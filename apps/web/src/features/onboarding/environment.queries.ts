import { type CredentialStatusDTO, type EnvironmentDTO, getEnvironmentOp, recheckEnvironmentOp } from '@aw/shared';
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

/** The master password operations answer with the new credential status (D167), which is part of the environment. */
export function useCredentialMutation<I>(run: (input: I) => Promise<CredentialStatusDTO>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (credentials) =>
      queryClient.setQueryData(queryKeys.environment, (environment: EnvironmentDTO | undefined) =>
        environment === undefined ? undefined : { ...environment, credentials },
      ),
  });
}
