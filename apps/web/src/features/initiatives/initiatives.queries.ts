import {
  type CreateInitiativeRequest,
  confirmInitiativeItemMergedOp,
  confirmInitiativeOp,
  createInitiativeOp,
  deleteInitiativeOp,
  deliverInitiativePhaseOp,
  dropInitiativeItemOp,
  getInitiativeOp,
  type InitiativeDetailDTO,
  type InitiativeDraft,
  listInitiativesOp,
  listInitiativeTemplatesOp,
  openInitiativePhaseOp,
  saveInitiativeDraftOp,
  startInitiativeItemOp,
} from '@aw/shared';
import { type QueryClient, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';

export const initiativeTemplatesQuery = queryOptions({
  queryKey: queryKeys.initiativeTemplates,
  queryFn: async () => (await callOperation(listInitiativeTemplatesOp, {})).items,
});

export const initiativesQuery = (filter: { projectId?: string } = {}) =>
  queryOptions({
    queryKey: queryKeys.initiatives(filter),
    queryFn: async () => (await callOperation(listInitiativesOp, { ...filter })).items,
  });

export const initiativeQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.initiative(id), queryFn: () => callOperation(getInitiativeOp, { id }) });

/** `initiative.updated` (34 §10): the initiative and the lists it is in are read again. */
export const refreshInitiatives = (qc: QueryClient, id: string) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.initiative(id) }),
    qc.invalidateQueries({ queryKey: queryKeys.initiativeLists }),
  ]);

/** Every change returns the initiative; its work packages may have started tasks, so task lists refetch too. */
function useInitiativeChange<I>(run: (input: I) => Promise<InitiativeDetailDTO>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async (initiative) => {
      qc.setQueryData(queryKeys.initiative(initiative.id), initiative);
      await qc.invalidateQueries({ queryKey: queryKeys.taskLists });
    },
  });
}

export const useCreateInitiative = () =>
  useInitiativeChange((input: CreateInitiativeRequest) => callOperation(createInitiativeOp, input));
export const useSaveInitiativeDraft = () =>
  useInitiativeChange((input: { id: string } & InitiativeDraft) => callOperation(saveInitiativeDraftOp, input));
export const useConfirmInitiative = () =>
  useInitiativeChange((id: string) => callOperation(confirmInitiativeOp, { id }));
export const useOpenInitiativePhase = () =>
  useInitiativeChange((input: { id: string; phase: number }) => callOperation(openInitiativePhaseOp, input));
export const useStartInitiativeItem = () =>
  useInitiativeChange((input: { id: string; key: string }) => callOperation(startInitiativeItemOp, input));
export const useConfirmInitiativeItemMerged = () =>
  useInitiativeChange((input: { id: string; key: string }) => callOperation(confirmInitiativeItemMergedOp, input));
export const useDropInitiativeItem = () =>
  useInitiativeChange((input: { id: string; key: string; reason: string }) =>
    callOperation(dropInitiativeItemOp, input),
  );

export function useDeliverInitiativePhase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; phase: number }) => callOperation(deliverInitiativePhaseOp, input),
    onSuccess: async ({ initiative }) => {
      qc.setQueryData(queryKeys.initiative(initiative.id), initiative);
      await qc.invalidateQueries({ queryKey: queryKeys.taskLists });
    },
  });
}

export function useDeleteInitiative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => callOperation(deleteInitiativeOp, { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.initiativeLists }),
  });
}
