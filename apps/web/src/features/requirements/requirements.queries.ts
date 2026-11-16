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
import { refreshTaskAfterMutation } from '../tasks/tasks.queries.ts';

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
    onSuccess: async (view) => {
      const key = queryKeys.taskRequirements(taskId);
      qc.setQueryData(key, view);
      await qc.invalidateQueries({ queryKey: [...key, 'history'] });
    },
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
    mutationFn: (input: {
      id: string;
      revisionId?: string;
      expectedCommitSha?: string;
      items?: RequirementItemInput[];
    }) => callOperation(reverifyRequirementsOp, input),
    onSuccess: (task) =>
      Promise.all([
        refreshTaskAfterMutation(qc, task),
        qc.invalidateQueries({ queryKey: queryKeys.taskRequirements(task.id) }),
      ]),
  });
};
