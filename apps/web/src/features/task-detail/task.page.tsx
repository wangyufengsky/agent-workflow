import { type TaskDetailDTO, TaskStatus } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { ROUTE_IDS } from '../../app/routes.ts';
import { ProgressCanvas } from '../../canvas/progress-canvas.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { TASK_COPY as C } from '../../copy/tasks.ts';
import { taskQuery } from '../tasks/tasks.queries.ts';
import { FailurePanel } from './failure-panel.tsx';
import { NodeDrawer } from './node-drawer.tsx';
import { PlanReview } from './plan-review.tsx';
import { PlanningProgress } from './planning-progress.tsx';
import { ResultCard } from './result-card.tsx';
import { stepsOfNodes } from './steps.ts';
import { TaskHeader } from './task-header.tsx';
import styles from './task-page.module.css';
import { TaskSide } from './task-side.tsx';

const route = getRouteApi(ROUTE_IDS.task);

type Selection = { selected: string | undefined; select: (id: string) => void; open: (id: string) => void };

/** Canvas of the task's steps with the side panel. */
function StepsView({ task, selection }: { task: TaskDetailDTO; selection: Selection }) {
  return (
    <div className={styles.layout}>
      <ProgressCanvas
        steps={stepsOfNodes(task)}
        selectedId={selection.selected}
        onSelect={selection.select}
        onOpen={selection.open}
      />
      <TaskSide task={task} selectedId={selection.selected} onOpen={selection.open} />
    </div>
  );
}

/** The main area follows the task's state (14 §3.3). */
function TaskMain({ task, selection }: { task: TaskDetailDTO; selection: Selection }) {
  switch (task.status) {
    case TaskStatus.Draft:
    case TaskStatus.Preparing:
    case TaskStatus.Planning:
      return (
        <div className={styles.layout}>
          <PlanningProgress task={task} />
          <TaskSide task={task} selectedId={undefined} onOpen={selection.open} />
        </div>
      );
    case TaskStatus.PlanReview:
      return <PlanReview task={task} />;
    case TaskStatus.Running:
    case TaskStatus.Paused:
      return <StepsView task={task} selection={selection} />;
    case TaskStatus.Failed:
      return (
        <div className="col">
          <FailurePanel task={task} />
          {task.nodes.length > 0 && <StepsView task={task} selection={selection} />}
        </div>
      );
    case TaskStatus.Review:
    case TaskStatus.Merging:
    case TaskStatus.Completed:
    case TaskStatus.Cancelled:
      return (
        <div className="col">
          {task.result !== null || task.status === TaskStatus.Review ? <ResultCard task={task} /> : null}
          {task.nodes.length > 0 && (
            <details className={styles.canvasFold} open={task.result === null}>
              <summary className="hint">{C.canvasToggle}</summary>
              <StepsView task={task} selection={selection} />
            </details>
          )}
        </div>
      );
  }
}

export function TaskPage() {
  const { taskId } = route.useParams();
  const { node } = route.useSearch();
  const navigate = route.useNavigate();
  const task = useQuery(taskQuery(taskId));
  const selection: Selection = {
    selected: node,
    select: (id) => void navigate({ search: { node: id, open: false }, replace: true }),
    open: (id) => void navigate({ search: { node: id, open: true } }),
  };
  const { open } = route.useSearch();
  if (task.isPending) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (task.isError) return <ErrorState error={task.error} onRetry={() => void task.refetch()} />;
  return (
    <div className="page wide" data-testid="task-page">
      <TaskHeader task={task.data} />
      <TaskMain task={task.data} selection={selection} />
      <NodeDrawer
        taskId={taskId}
        nodeId={open === true ? node : undefined}
        onClose={() => void navigate({ search: { node, open: false }, replace: true })}
      />
    </div>
  );
}
