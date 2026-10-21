import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { SCHEDULES_COPY as C } from '../../copy/schedules.ts';
import { projectsQuery } from '../projects/projects.queries.ts';
import { ScheduleForm } from './schedule-form.tsx';
import { scheduleQuery, useUpdateSchedule } from './schedules.queries.ts';

const route = getRouteApi(ROUTE_IDS.scheduleEdit);

/** 「修改定时任务」(22 §7): the same form; the project stays. */
export function EditSchedulePage() {
  const { scheduleId } = route.useParams();
  const navigate = useNavigate();
  const projects = useQuery(projectsQuery).data ?? [];
  const schedule = useQuery(scheduleQuery(scheduleId));
  const update = useUpdateSchedule();
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="title grow">{C.editTitle}</h1>
      </div>
      {schedule.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {schedule.isError && <ErrorState error={schedule.error} onRetry={() => void schedule.refetch()} />}
      {schedule.data !== undefined && projects.length > 0 && (
        <ScheduleForm
          projects={projects}
          initial={schedule.data}
          submitLabel={C.submitSave}
          pending={update.isPending}
          error={update.error}
          onSubmit={({ projectId: _, ...value }) =>
            update.mutate(
              { id: scheduleId, ...value },
              { onSuccess: () => void navigate({ to: ROUTES.schedule, params: { scheduleId } }) },
            )
          }
        />
      )}
    </div>
  );
}
