import { listProjectSkillBindingsOp, listSkillsOp } from '@aw/shared';
import { queryOptions } from '@tanstack/react-query';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';

export const skillsQuery = queryOptions({
  queryKey: queryKeys.skillLibrary,
  queryFn: async () => (await callOperation(listSkillsOp, {})).items,
});

export const projectSkillBindingsQuery = (projectId: string) =>
  queryOptions({
    queryKey: queryKeys.projectSkillBindings(projectId),
    queryFn: async () => (await callOperation(listProjectSkillBindingsOp, { projectId })).items,
  });
