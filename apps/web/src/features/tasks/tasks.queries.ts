import {
  acceptNodeOp,
  type CreateRoleRequest,
  type CreateTaskRequest,
  type CreateWorkflowRequest,
  cancelTaskOp,
  confirmPlanOp,
  createRoleOp,
  createTaskOp,
  createWorkflowOp,
  type DeliverRequest,
  deleteRoleOp,
  deleteWorkflowOp,
  deliverTaskOp,
  getNodeOp,
  getTaskOp,
  getWorkflowOp,
  listRolesOp,
  listTasksOp,
  listWorkflowsOp,
  listWorkflowVersionsOp,
  type NodeDetailDTO,
  type NodeSummaryDTO,
  nodeDiffFileOp,
  nodeDiffOp,
  type PlanGraph,
  pauseTaskOp,
  type RequestChangesRequest,
  type ReviseFromReviewRequest,
  rejectNodeOp,
  replanOp,
  requestChangesOp,
  resumeTaskOp,
  retryNodeOp,
  retryTaskOp,
  reviewCommentsOp,
  reviseFromReviewOp,
  saveDraftPlanOp,
  skipCheckOp,
  skipNodeOp,
  startTaskOp,
  type TaskDetailDTO,
  type TaskDisplayGroup,
  type TaskSummaryDTO,
  taskDiffFileOp,
  taskDiffOp,
  type UpdateRoleRequest,
  type UpdateWorkflowRequest,
  updateCheckCommandOp,
  updateRoleOp,
  updateWorkflowOp,
} from '@aw/shared';
import {
  infiniteQueryOptions,
  type QueryClient,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import type { FileDiffQuery } from '../../components/diff/diff-browser.tsx';

export const workflowsQuery = queryOptions({
  queryKey: queryKeys.workflows,
  queryFn: async () => (await callOperation(listWorkflowsOp, {})).items,
});

export const workflowQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.workflow(id), queryFn: () => callOperation(getWorkflowOp, { id }) });

export const workflowVersionsQuery = (key: string) =>
  queryOptions({
    queryKey: queryKeys.workflowVersions(key),
    queryFn: async () => (await callOperation(listWorkflowVersionsOp, { key })).items,
  });

/**
 * Workflow and role definitions changed (M5-05 / M5-06): every list and version view refetches. Not awaited: a saved
 * workflow version is a new row, so the refetch remounts its editor, and the caller's `onSuccess` must run first.
 */
function useDefinitionMutation<I, O>(run: (input: I) => Promise<O>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflows });
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles });
    },
  });
}
export const useCreateWorkflow = () =>
  useDefinitionMutation((input: CreateWorkflowRequest) => callOperation(createWorkflowOp, input));
export const useUpdateWorkflow = () =>
  useDefinitionMutation((input: UpdateWorkflowRequest) => callOperation(updateWorkflowOp, input));
export const useDeleteWorkflow = () => useDefinitionMutation((key: string) => callOperation(deleteWorkflowOp, { key }));
export const useCreateRole = () =>
  useDefinitionMutation((input: CreateRoleRequest) => callOperation(createRoleOp, input));
export const useUpdateRole = () =>
  useDefinitionMutation((input: UpdateRoleRequest) => callOperation(updateRoleOp, input));
export const useDeleteRole = () => useDefinitionMutation((id: string) => callOperation(deleteRoleOp, { id }));

export const rolesQuery = queryOptions({
  queryKey: queryKeys.roles,
  queryFn: async () => (await callOperation(listRolesOp, {})).items,
});

export type TaskFilter = { projectId?: string; displayGroup?: TaskDisplayGroup };

export const tasksQuery = (filter: TaskFilter = {}) =>
  queryOptions({
    queryKey: queryKeys.tasks(filter),
    queryFn: async () => (await callOperation(listTasksOp, { ...filter })).items,
  });

/** The first page is asked for without a cursor. */
const FIRST_PAGE = '';

/** Every loaded page of a filtered list (11 §1 pagination), for the tasks page's「加载更多」. */
export const taskPagesQuery = (filter: TaskFilter = {}) =>
  infiniteQueryOptions({
    queryKey: queryKeys.taskPages(filter),
    queryFn: ({ pageParam }) =>
      callOperation(listTasksOp, { ...filter, ...(pageParam === FIRST_PAGE ? {} : { cursor: pageParam }) }),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const taskQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.task(id), queryFn: () => callOperation(getTaskOp, { id }) });

export const nodeQuery = (taskId: string, nodeId: string) =>
  queryOptions({
    queryKey: queryKeys.node(taskId, nodeId),
    queryFn: () => callOperation(getNodeOp, { id: taskId, nodeId }),
  });

export const taskDiffQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.taskDiff(id), queryFn: () => callOperation(taskDiffOp, { id }) });

export const taskDiffFileQuery =
  (id: string): FileDiffQuery =>
  (path) => ({
    queryKey: queryKeys.taskDiffFile(id, path),
    queryFn: () => callOperation(taskDiffFileOp, { id, path }),
  });

export const nodeDiffQuery = (taskId: string, nodeId: string) =>
  queryOptions({
    queryKey: queryKeys.nodeDiff(taskId, nodeId),
    queryFn: () => callOperation(nodeDiffOp, { id: taskId, nodeId }),
  });

export const nodeDiffFileQuery =
  (taskId: string, nodeId: string): FileDiffQuery =>
  (path) => ({
    queryKey: queryKeys.nodeDiffFile(taskId, nodeId, path),
    queryFn: () => callOperation(nodeDiffFileOp, { id: taskId, nodeId, path }),
  });

/**
 * Refetches a detail after an event about it. A first read still in flight may have been answered before the event
 * (a refetch would join it and keep its older answer), so it is cancelled and read again.
 */
async function refetchAfterEvent(qc: QueryClient, queryKey: readonly unknown[]): Promise<void> {
  await qc.cancelQueries({ queryKey, exact: true });
  await qc.invalidateQueries({ queryKey, exact: true });
}

/** SSE `task.updated`: lists refetch (order and filters may change); a loaded detail takes the summary fields. */
export async function updateTask(qc: QueryClient, summary: TaskSummaryDTO): Promise<void> {
  const detail = queryKeys.task(summary.id);
  // Cancelled first: cancelling restores the state from before the read, which would undo the update.
  await qc.cancelQueries({ queryKey: detail, exact: true });
  qc.setQueryData<TaskDetailDTO>(detail, (old) =>
    old === undefined ? old : { ...old, ...summary, workflow: old.workflow },
  );
  await Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.taskLists }),
    // The detail's plan, nodes, items and result change with its state; refetch it in the background.
    qc.invalidateQueries({ queryKey: detail, exact: true }),
  ]);
}

/** SSE `node.updated`: the node in a loaded task detail, and its own detail. */
export async function updateNode(qc: QueryClient, taskId: string, node: NodeSummaryDTO): Promise<void> {
  qc.setQueryData<TaskDetailDTO>(queryKeys.task(taskId), (old) =>
    old === undefined ? old : { ...old, nodes: old.nodes.map((n) => (n.id === node.id ? node : n)) },
  );
  await refetchAfterEvent(qc, queryKeys.node(taskId, node.id));
}

function useTaskMutation<I>(run: (input: I) => Promise<TaskDetailDTO>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async (task) => {
      queryClient.setQueryData(queryKeys.task(task.id), task);
      await queryClient.invalidateQueries({ queryKey: queryKeys.taskLists });
    },
  });
}

export const useCreateTask = () => useTaskMutation((input: CreateTaskRequest) => callOperation(createTaskOp, input));
export const useCancelTask = () => useTaskMutation((id: string) => callOperation(cancelTaskOp, { id }));
export const useRetryTask = () =>
  useTaskMutation((input: { id: string; feedback?: string }) => callOperation(retryTaskOp, input));
export const useSkipCheck = () => useTaskMutation((id: string) => callOperation(skipCheckOp, { id }));

/** The new check command may become the project's too (D116). */
export function useUpdateCheckCommand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; command: string; updateProject: boolean }) =>
      callOperation(updateCheckCommandOp, input),
    onSuccess: async (task, input) => {
      queryClient.setQueryData(queryKeys.task(task.id), task);
      await queryClient.invalidateQueries({ queryKey: queryKeys.taskLists });
      if (input.updateProject) await queryClient.invalidateQueries({ queryKey: queryKeys.project(task.project.id) });
    },
  });
}
export const useConfirmPlan = () =>
  useTaskMutation((input: { id: string; version: number }) => callOperation(confirmPlanOp, input));
export const useDeliver = () => useTaskMutation((input: DeliverRequest) => callOperation(deliverTaskOp, input));
export const useRequestChanges = () =>
  useTaskMutation((input: RequestChangesRequest) => callOperation(requestChangesOp, input));
export const useReviseFromReview = () =>
  useTaskMutation((input: ReviseFromReviewRequest) => callOperation(reviseFromReviewOp, input));

/** Review comments of the task's open pull request, read live from the platform when the user asks (D87). */
export const reviewCommentsQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.reviewComments(id),
    queryFn: () => callOperation(reviewCommentsOp, { id }),
    enabled: false,
  });
export const useReplan = () =>
  useTaskMutation((input: { id: string; feedback: string }) => callOperation(replanOp, input));
export const useStartTask = () => useTaskMutation((id: string) => callOperation(startTaskOp, { id }));
export const usePauseTask = () => useTaskMutation((id: string) => callOperation(pauseTaskOp, { id }));
export const useResumeTask = () => useTaskMutation((id: string) => callOperation(resumeTaskOp, { id }));

/** A user-edited plan saved as a new draft version (M5-01 / M5-02); the task detail then shows it. */
export function useSaveDraftPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; baseVersion: number; graph: PlanGraph }) => callOperation(saveDraftPlanOp, input),
    onSuccess: (_plan, input) => queryClient.invalidateQueries({ queryKey: queryKeys.task(input.id), exact: true }),
  });
}

/** Step actions of the pro view (M5-03): the node detail comes back; the task refetches through SSE. */
function useNodeMutation<I extends { id: string; nodeId: string }>(run: (input: I) => Promise<NodeDetailDTO>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (node) => queryClient.setQueryData(queryKeys.node(node.taskId, node.id), node),
  });
}
export const useSkipNode = () =>
  useNodeMutation((input: { id: string; nodeId: string }) => callOperation(skipNodeOp, input));
export const useRetryNode = () =>
  useNodeMutation((input: { id: string; nodeId: string; feedback?: string }) => callOperation(retryNodeOp, input));

export function useAcceptNode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; nodeId: string }) => callOperation(acceptNodeOp, input),
    onSuccess: (node) => queryClient.setQueryData(queryKeys.node(node.taskId, node.id), node),
  });
}

export function useRejectNode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; nodeId: string; feedback: string }) => callOperation(rejectNodeOp, input),
    onSuccess: (node) => queryClient.setQueryData(queryKeys.node(node.taskId, node.id), node),
  });
}
