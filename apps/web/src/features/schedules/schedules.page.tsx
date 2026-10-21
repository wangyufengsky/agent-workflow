import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { EmptyState } from '../../components/empty-state.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { SCHEDULES_COPY as C } from '../../copy/schedules.ts';
import { ScheduleCard } from './schedule-card.tsx';
import { schedulesQuery } from './schedules.queries.ts';

/** Every schedule, newest first (22 §7). */
export function SchedulesPage() {
  const schedules = useQuery(schedulesQuery());
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{C.title}</h1>
          <p className="lede">{C.lede}</p>
        </div>
        <Link to={ROUTES.scheduleNew} className="btn primary">
          {C.create}
        </Link>
      </div>
      {schedules.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {schedules.isError && <ErrorState error={schedules.error} onRetry={() => void schedules.refetch()} />}
      {schedules.data?.length === 0 && <EmptyState icon="clock" title={C.empty} body={C.emptyBody} />}
      <div className="grid-2">
        {schedules.data?.map((s) => (
          <ScheduleCard key={s.id} schedule={s} />
        ))}
      </div>
    </div>
  );
}
