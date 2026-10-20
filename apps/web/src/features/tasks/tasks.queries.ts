import {
  acceptNodeOp,
  type ChangeRequestReason,
  type CreateTaskRequest,
  cancelTaskOp,
  confirmPlanOp,
  createTaskOp,
  type DeliverRequest,
  deliverTaskOp,
  getNodeOp,
  getTaskOp,
  listRolesOp,
  listTasksOp,
  listWorkflowsOp,
  type NodeSummaryDTO,
  nodeDiffFileOp,
  nodeDiffOp,
  rejectNodeOp,
  replanOp,
  requestChangesOp,
  retryTaskOp,
  type TaskDetailDTO,
  type TaskDisplayGroup,
  type TaskSummaryDTO,
  taskDiffFileOp,
  taskDiffOp,
} from '@aw/shared';
import { type QueryClient, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import type { FileDiffQuery } from '../../components/diff/diff-browser.tsx';

export const workflowsQuery = queryOptions({
  queryKey: queryKeys.workflows,
  queryFn: async () => (await callOperation(listWorkflowsOp, {})).items,
});

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

/** SSE `task.updated`: lists refetch (order and filters may change); a loaded detail takes the summary fields. */
export async function updateTask(qc: QueryClient, summary: TaskSummaryDTO): Promise<void> {
  qc.setQueryData<TaskDetailDTO>(queryKeys.task(summary.id), (old) =>
    old === undefined ? old : { ...old, ...summary, workflow: old.workflow },
  );
  await Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.taskLists }),
    // The detail's plan, nodes, items and result change with its state; refetch it in the background.
    qc.invalidateQueries({ queryKey: queryKeys.task(summary.id), exact: true }),
  ]);
}

/** SSE `node.updated`: the node in a loaded task detail, and its own detail. */
export async function updateNode(qc: QueryClient, taskId: string, node: NodeSummaryDTO): Promise<void> {
  qc.setQueryData<TaskDetailDTO>(queryKeys.task(taskId), (old) =>
    old === undefined ? old : { ...old, nodes: old.nodes.map((n) => (n.id === node.id ? node : n)) },
  );
  await qc.invalidateQueries({ queryKey: queryKeys.node(taskId, node.id) });
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
export const useRetryTask = () => useTaskMutation((id: string) => callOperation(retryTaskOp, { id }));
export const useConfirmPlan = () =>
  useTaskMutation((input: { id: string; version: number }) => callOperation(confirmPlanOp, input));
export const useDeliver = () => useTaskMutation((input: DeliverRequest) => callOperation(deliverTaskOp, input));
export const useRequestChanges = () =>
  useTaskMutation((input: { id: string; reason: ChangeRequestReason; feedback?: string }) =>
    callOperation(requestChangesOp, input),
  );
export const useReplan = () =>
  useTaskMutation((input: { id: string; feedback: string }) => callOperation(replanOp, input));

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
