import {
  type CreateScheduleRequest,
  createScheduleOp,
  deleteScheduleOp,
  getScheduleOp,
  listSchedulesOp,
  pauseScheduleOp,
  resumeScheduleOp,
  runScheduleOp,
  type ScheduleDetailDTO,
  type UpdateScheduleRequest,
  updateScheduleOp,
} from '@aw/shared';
import { type QueryClient, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';

export type ScheduleFilter = { projectId?: string };

export const schedulesQuery = (filter: ScheduleFilter = {}) =>
  queryOptions({
    queryKey: queryKeys.schedules(filter),
    queryFn: async () => (await callOperation(listSchedulesOp, { ...filter })).items,
  });

export const scheduleQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.schedule(id), queryFn: () => callOperation(getScheduleOp, { id }) });

/** SSE `schedule.updated` (22 §9): a schedule was created, changed, ran or was deleted. */
export const refreshSchedules = (qc: QueryClient, scheduleId: string) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.scheduleLists }),
    qc.invalidateQueries({ queryKey: queryKeys.schedule(scheduleId) }),
  ]);

/** Every change returns the schedule; a run also made a task, which the task lists show. */
function useScheduleMutation<I>(fn: (input: I) => Promise<ScheduleDetailDTO>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (schedule) => {
      queryClient.setQueryData(queryKeys.schedule(schedule.id), schedule);
      await queryClient.invalidateQueries({ queryKey: queryKeys.taskLists });
    },
  });
}

export const useCreateSchedule = () =>
  useScheduleMutation((input: CreateScheduleRequest) => callOperation(createScheduleOp, input));
export const useUpdateSchedule = () =>
  useScheduleMutation((input: UpdateScheduleRequest) => callOperation(updateScheduleOp, input));
export const usePauseSchedule = () => useScheduleMutation((id: string) => callOperation(pauseScheduleOp, { id }));
export const useResumeSchedule = () => useScheduleMutation((id: string) => callOperation(resumeScheduleOp, { id }));
export const useRunSchedule = () => useScheduleMutation((id: string) => callOperation(runScheduleOp, { id }));

export function useDeleteSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => callOperation(deleteScheduleOp, { id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.scheduleLists }),
  });
}
