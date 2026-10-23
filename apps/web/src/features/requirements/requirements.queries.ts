import {
  type DecideRequirementRequest,
  decideRequirementOp,
  getRequirementsOp,
  type RequirementItemInput,
  replaceRequirementsOp,
  reverifyRequirementsOp,
  type TaskRequirementsDTO,
} from '@aw/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';

export const requirementsQuery = (taskId: string) =>
  queryOptions({
    queryKey: queryKeys.taskRequirements(taskId),
    queryFn: () => callOperation(getRequirementsOp, { id: taskId }),
  });

/** Saving and deciding answer with the checklist as it is now. */
function useChecklistMutation<I>(taskId: string, run: (input: I) => Promise<TaskRequirementsDTO>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (view) => qc.setQueryData(queryKeys.taskRequirements(taskId), view),
  });
}

export const useReplaceRequirements = (taskId: string) =>
  useChecklistMutation(taskId, (items: RequirementItemInput[]) =>
    callOperation(replaceRequirementsOp, { id: taskId, items }),
  );

export const useDecideRequirement = (taskId: string) =>
  useChecklistMutation(taskId, (input: Omit<DecideRequirementRequest, 'id'>) =>
    callOperation(decideRequirementOp, { id: taskId, ...input }),
  );

export const useReverifyRequirements = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => callOperation(reverifyRequirementsOp, { id: taskId }),
    onSuccess: (task) => qc.setQueryData(queryKeys.task(task.id), task),
  });
};
