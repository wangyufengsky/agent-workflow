import {
  type CreateProjectRequest,
  clearProjectHostingOp,
  createProjectOp,
  deleteProjectOp,
  getAgentsMdOp,
  getProjectOp,
  initGitOp,
  listProjectsOp,
  type ProjectDetailDTO,
  previewGitInitOp,
  removeProjectAllowedBashOp,
  type SetHostingRequest,
  type StartAgentsMdTaskRequest,
  setProjectHostingOp,
  startAgentsMdTaskOp,
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

/** What putting a directory in no repository under Git would commit (D153); read again each time it is shown. */
export const gitInitPreviewQuery = (repoPath: string) =>
  queryOptions({
    queryKey: queryKeys.gitInitPreview(repoPath),
    queryFn: () => callOperation(previewGitInitOp, { repoPath }),
    gcTime: 0,
  });

function useAddProject(add: (input: CreateProjectRequest) => Promise<ProjectDetailDTO>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: add,
    onSuccess: async (project) => {
      queryClient.setQueryData(queryKeys.project(project.id), project);
      // Refetch even when no list is mounted: the shell's onboarding check reads the cached list next.
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects, exact: true, refetchType: 'all' });
      // The project's own opencode configuration may add models (D162).
      await queryClient.invalidateQueries({ queryKey: queryKeys.environment });
    },
  });
}

export const useCreateProject = () => useAddProject((input) => callOperation(createProjectOp, input));
export const useInitGit = () => useAddProject((input) => callOperation(initGitOp, input));

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
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projects, exact: true, refetchType: 'all' }),
        // Models only its own opencode configuration provided go with it (D162).
        queryClient.invalidateQueries({ queryKey: queryKeys.environment }),
      ]);
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
export const useRemoveAllowedBash = () =>
  useProjectMutation((input: { id: string; pattern: string }) => callOperation(removeProjectAllowedBashOp, input));

/** The root AGENTS.md on the project's default branch and its task in progress (40 §6). */
export const agentsMdQuery = (projectId: string) =>
  queryOptions({
    queryKey: queryKeys.agentsMd(projectId),
    queryFn: () => callOperation(getAgentsMdOp, { id: projectId }),
  });

export function useStartAgentsMdTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StartAgentsMdTaskRequest) => callOperation(startAgentsMdTaskOp, input),
    onSuccess: (task) => queryClient.invalidateQueries({ queryKey: queryKeys.agentsMd(task.project.id) }),
  });
}
