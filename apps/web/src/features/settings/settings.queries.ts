import { getSettingsOp, type SettingsPatch, updateSettingsOp } from '@aw/shared';
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';

export const settingsQuery = queryOptions({
  queryKey: queryKeys.settings,
  queryFn: () => callOperation(getSettingsOp, {}),
});

/** Settings are loaded by the root route before anything renders, so they are always available. */
export function useSettings() {
  return useSuspenseQuery(settingsQuery).data;
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => callOperation(updateSettingsOp, patch),
    onSuccess: (settings) => queryClient.setQueryData(queryKeys.settings, settings),
  });
}
