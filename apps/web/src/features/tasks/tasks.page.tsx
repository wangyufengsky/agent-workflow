import { TASK_DISPLAY_GROUPS, type TaskDisplayGroup, taskDisplayGroupSchema } from '@aw/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { EmptyState } from '../../components/empty-state.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { BATCHES_COPY } from '../../copy/batches.ts';
import { COMMON_COPY, formatDateTime } from '../../copy/common.ts';
import { INITIATIVES_COPY } from '../../copy/initiatives.ts';
import { SCHEDULES_COPY } from '../../copy/schedules.ts';
import { TASKS_COPY as C, TASK_DISPLAY_LABEL } from '../../copy/tasks.ts';
import { projectsQuery } from '../projects/projects.queries.ts';
import { TaskBadge } from './task-badge.tsx';
import styles from './tasks.module.css';
import { taskPagesQuery } from './tasks.queries.ts';

const route = getRouteApi(ROUTE_IDS.tasks);

/** Task list (14 §3.7): filter by project and display state. */
export function TasksPage() {
  const { projectId, displayGroup } = route.useSearch();
  const navigate = route.useNavigate();
  const projects = useQuery(projectsQuery);
  const pages = useInfiniteQuery(
    taskPagesQuery({
      ...(projectId === undefined ? {} : { projectId }),
      ...(displayGroup === undefined ? {} : { displayGroup }),
    }),
  );
  const rows = pages.data?.pages.flatMap((page) => page.items);
  const setFilter = (next: { projectId?: string | undefined; displayGroup?: TaskDisplayGroup | undefined }) =>
    void navigate({ search: (prev) => ({ ...prev, ...next }) });

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{C.title}</h1>
          <p className="lede">{C.lede}</p>
        </div>
        <div className={styles.filters}>
          <Link to={ROUTES.initiatives} className="btn ghost">
            {INITIATIVES_COPY.title}
          </Link>
          <Link to={ROUTES.batches} className="btn ghost">
            {BATCHES_COPY.title}
          </Link>
          <Link to={ROUTES.schedules} className="btn ghost">
            {SCHEDULES_COPY.title}
          </Link>
          <select
            className="select"
            aria-label={C.allProjects}
            value={projectId ?? ''}
            onChange={(e) => setFilter({ projectId: e.target.value === '' ? undefined : e.target.value })}
          >
            <option value="">{C.allProjects}</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            className="select"
            aria-label={C.allStates}
            value={displayGroup ?? ''}
            onChange={(e) =>
              setFilter({
                displayGroup: e.target.value === '' ? undefined : taskDisplayGroupSchema.parse(e.target.value),
              })
            }
          >
            <option value="">{C.allStates}</option>
            {TASK_DISPLAY_GROUPS.map((g) => (
              <option key={g} value={g}>
                {TASK_DISPLAY_LABEL[g]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {pages.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {pages.isError && <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />}
      {rows?.length === 0 && <EmptyState icon="list" title={C.empty} body={C.emptyBody} />}
      {rows !== undefined && rows.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{C.columns.title}</th>
              <th>{C.columns.project}</th>
              <th>{C.columns.workflow}</th>
              <th>{C.columns.status}</th>
              <th>{C.columns.updated}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td>
                  <Link to={ROUTES.task} params={{ taskId: t.id }} search={{}}>
                    <span className="mono hint">{t.key}</span> {t.title}
                  </Link>
                </td>
                <td>{t.project.name}</td>
                <td>{t.workflow.name}</td>
                <td>
                  <TaskBadge group={t.displayGroup} />
                </td>
                <td className="hint">{formatDateTime(t.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pages.hasNextPage && (
        <div className="row">
          <Button pending={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
            {COMMON_COPY.loadMore}
          </Button>
        </div>
      )}
    </div>
  );
}
