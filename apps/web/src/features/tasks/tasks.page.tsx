import { TASK_DISPLAY_GROUPS, type TaskDisplayGroup, taskDisplayGroupSchema } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { EmptyState } from '../../components/empty-state.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { TASKS_COPY as C, TASK_DISPLAY_LABEL } from '../../copy/tasks.ts';
import { projectsQuery } from '../projects/projects.queries.ts';
import { TaskBadge } from './task-badge.tsx';
import styles from './tasks.module.css';
import { tasksQuery } from './tasks.queries.ts';

const route = getRouteApi(ROUTE_IDS.tasks);
const time = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' });

/** Task list (14 §3.7): filter by project and display state. */
export function TasksPage() {
  const { projectId, displayGroup } = route.useSearch();
  const navigate = route.useNavigate();
  const projects = useQuery(projectsQuery);
  const tasks = useQuery(
    tasksQuery({
      ...(projectId === undefined ? {} : { projectId }),
      ...(displayGroup === undefined ? {} : { displayGroup }),
    }),
  );
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
      {tasks.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {tasks.isError && <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />}
      {tasks.data?.length === 0 && <EmptyState icon="list" title={C.empty} body={C.emptyBody} />}
      {tasks.data !== undefined && tasks.data.length > 0 && (
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
            {tasks.data.map((t) => (
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
                <td className="hint">{time.format(t.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
