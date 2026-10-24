import {
  getTeamSettingsOp,
  type TeamIdentityUpdate,
  type TeamQuery,
  type TeamSettingsUpdate,
  teamCommitsOp,
  teamMemberOp,
  teamSummaryOp,
  updateTeamIdentityOp,
  updateTeamSettingsOp,
} from '@aw/shared';
import { infiniteQueryOptions, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';

const params = (q: TeamQuery) => ({
  ref: q.ref,
  period: q.period,
  from: q.from,
  to: q.to,
  granularity: q.granularity,
});

export const teamSummaryQuery = (query: TeamQuery) =>
  queryOptions({
    queryKey: queryKeys.teamResource(query.id, 'summary', params(query)),
    queryFn: () => callOperation(teamSummaryOp, query),
  });

export const teamMemberQuery = (query: TeamQuery, member: string) =>
  queryOptions({
    queryKey: queryKeys.teamResource(query.id, 'member', { ...params(query), member }),
    queryFn: () => callOperation(teamMemberOp, { ...query, member }),
  });

export const teamCommitsQuery = (query: TeamQuery, member: string) =>
  infiniteQueryOptions({
    queryKey: queryKeys.teamResource(query.id, 'commits', { ...params(query), member }),
    queryFn: ({ pageParam }) => callOperation(teamCommitsOp, { ...query, member, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const teamSettingsQuery = (projectId: string) =>
  queryOptions({
    queryKey: queryKeys.teamResource(projectId, 'settings', {}),
    queryFn: () => callOperation(getTeamSettingsOp, { id: projectId }),
  });

/** Identities and rules change every figure of the project: all its team queries are read again. */
function useTeamMutation<I, O>(projectId: string, mutationFn: (input: I) => Promise<O>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.team(projectId) }),
  });
}

export const useUpdateIdentity = (projectId: string) =>
  useTeamMutation(projectId, (update: Omit<TeamIdentityUpdate, 'id'>) =>
    callOperation(updateTeamIdentityOp, { id: projectId, ...update }),
  );

export const useUpdateTeamSettings = (projectId: string) =>
  useTeamMutation(projectId, (update: Omit<TeamSettingsUpdate, 'id'>) =>
    callOperation(updateTeamSettingsOp, { id: projectId, ...update }),
  );
