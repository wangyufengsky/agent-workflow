import { TaskDisplayGroup } from '@aw/shared';
import { useQueries } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { ErrorState } from '../../components/error-state.tsx';
import { Panel } from '../../components/panel.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { PROJECTS_COPY as C } from '../../copy/projects.ts';
import { TaskRow } from '../tasks/task-row.tsx';
import { tasksQuery } from '../tasks/tasks.queries.ts';

const PRIORITY_GROUPS: TaskDisplayGroup[] = [
  TaskDisplayGroup.Failed,
  TaskDisplayGroup.NeedsAttention,
  TaskDisplayGroup.PlanReview,
  TaskDisplayGroup.Review,
];
const RECENT_LIMIT = 5;

export function ProjectRecentTasks({ projectId }: { projectId: string }) {
  const queries = useQueries({
    queries: [
      tasksQuery({ projectId, limit: RECENT_LIMIT }),
      ...PRIORITY_GROUPS.map((displayGroup) => tasksQuery({ projectId, displayGroup, limit: RECENT_LIMIT })),
    ],
  });
  const error = queries.find((query) => query.isError);
  const tasks = new Map(queries.flatMap((query) => query.data ?? []).map((task) => [task.id, task]));
  const rows = [...tasks.values()]
    .sort((a, b) => {
      const priority =
        Number(PRIORITY_GROUPS.includes(b.displayGroup)) - Number(PRIORITY_GROUPS.includes(a.displayGroup));
      return priority || b.updatedAt - a.updatedAt;
    })
    .slice(0, RECENT_LIMIT);

  return (
    <Panel
      title={C.recentTasks}
      actions={
        <Link to={ROUTES.tasks} search={{ projectId }} className="btn sm">
          {C.viewProjectTasks}
        </Link>
      }
    >
      {queries.some((query) => query.isPending) ? (
        <p className="hint">{COMMON_COPY.loading}</p>
      ) : error ? (
        <ErrorState
          error={error.error}
          onRetry={() => {
            for (const query of queries) void query.refetch();
          }}
        />
      ) : rows.length === 0 ? (
        <p className="hint">{C.noRecentTasks}</p>
      ) : (
        rows.map((task) => <TaskRow key={task.id} task={task} />)
      )}
    </Panel>
  );
}
