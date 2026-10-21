import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { SCHEDULES_COPY as C } from '../../copy/schedules.ts';
import { projectsQuery } from '../projects/projects.queries.ts';
import { ScheduleForm } from './schedule-form.tsx';
import { useCreateSchedule } from './schedules.queries.ts';

const route = getRouteApi(ROUTE_IDS.scheduleNew);

/** 「新建定时任务」(22 §7), with the project and workflow it was opened for (the home page's「定时」). */
export function NewSchedulePage() {
  const search = route.useSearch();
  const navigate = useNavigate();
  const projects = useQuery(projectsQuery).data ?? [];
  const create = useCreateSchedule();
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{C.newTitle}</h1>
          <p className="lede">{C.lede}</p>
        </div>
      </div>
      {projects.length > 0 && (
        <ScheduleForm
          projects={projects}
          initialProjectId={search.projectId}
          initialWorkflowKey={search.workflow}
          submitLabel={C.submitCreate}
          pending={create.isPending}
          error={create.error}
          onSubmit={({ baseBranch, ...value }) =>
            create.mutate(
              { ...value, ...(baseBranch === null ? {} : { baseBranch }) },
              { onSuccess: (s) => void navigate({ to: ROUTES.schedule, params: { scheduleId: s.id } }) },
            )
          }
        />
      )}
    </div>
  );
}
