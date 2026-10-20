import {
  type CreateProjectRequest,
  clearProjectHostingOp,
  createProjectOp,
  deleteProjectOp,
  getProjectOp,
  listProjectsOp,
  type ProjectDetailDTO,
  type SetHostingRequest,
  setProjectHostingOp,
  type UpdateProjectRequest,
  updateProjectOp,
} from '@aw/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';

export const projectsQuery = queryOptions({
  queryKey: queryKeys.projects,
  queryFn: async () => (await callOperation(listProjectsOp, {})).items,
});

export const projectQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.project(id), queryFn: () => callOperation(getProjectOp, { id }) });

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectRequest) => callOperation(createProjectOp, input),
    onSuccess: async (project) => {
      queryClient.setQueryData(queryKeys.project(project.id), project);
      // Refetch even when no list is mounted: the shell's onboarding check reads the cached list next.
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects, exact: true, refetchType: 'all' });
    },
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProjectRequest) => callOperation(updateProjectOp, input),
    onSuccess: async (project) => {
      queryClient.setQueryData(queryKeys.project(project.id), project);
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects, exact: true });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => callOperation(deleteProjectOp, { id }),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.project(id) });
      return queryClient.invalidateQueries({ queryKey: queryKeys.projects, exact: true, refetchType: 'all' });
    },
  });
}

function useProjectMutation<I>(run: (input: I) => Promise<ProjectDetailDTO>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async (project) => {
      queryClient.setQueryData(queryKeys.project(project.id), project);
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects, exact: true });
    },
  });
}

export const useSetHosting = () =>
  useProjectMutation((input: SetHostingRequest) => callOperation(setProjectHostingOp, input));
export const useClearHosting = () => useProjectMutation((id: string) => callOperation(clearProjectHostingOp, { id }));
