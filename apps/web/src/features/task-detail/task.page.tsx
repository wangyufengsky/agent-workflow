import { EDITABLE_NODE_STATUSES, type TaskDetailDTO, TaskStatus, UiMode } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTE_IDS } from '../../app/routes.ts';
import { ProgressCanvas } from '../../canvas/progress-canvas.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { TASK_COPY as C } from '../../copy/tasks.ts';
import { useSettings } from '../settings/settings.queries.ts';
import { taskQuery } from '../tasks/tasks.queries.ts';
import { FailurePanel } from './failure-panel.tsx';
import { NodeDrawer } from './node-drawer.tsx';
import { PausedBanner } from './paused-banner.tsx';
import { PlanReview } from './plan-review.tsx';
import { PlanningProgress } from './planning-progress.tsx';
import { ResultCard } from './result-card.tsx';
import { stepsOfNodes } from './steps.ts';
import { TaskHeader } from './task-header.tsx';
import styles from './task-page.module.css';
import { TaskPlanEditor } from './task-plan-editor.tsx';
import { TaskSide } from './task-side.tsx';

const route = getRouteApi(ROUTE_IDS.task);

type Selection = { selected: string | undefined; select: (id: string) => void; open: (id: string) => void };
type MainProps = { task: TaskDetailDTO; selection: Selection; pro: boolean };

/** Canvas of the task's steps with the side panel. */
function StepsView({ task, selection, pro }: MainProps) {
  return (
    <div className={styles.layout}>
      <ProgressCanvas
        steps={stepsOfNodes(task)}
        selectedId={selection.selected}
        onSelect={selection.select}
        onOpen={selection.open}
      />
      <TaskSide task={task} selectedId={selection.selected} onOpen={selection.open} pro={pro} />
    </div>
  );
}

/** Paused (M5-02): the steps with the adjustment banner, or the plan editor with started steps locked. */
function PausedMain(props: MainProps) {
  const { task } = props;
  const [adjusting, setAdjusting] = useState(false);
  if (adjusting && task.plan !== null) {
    const base = task.draftPlan ?? task.plan;
    const lock = {
      base: task.plan.graph,
      locked: new Set(task.nodes.filter((n) => !EDITABLE_NODE_STATUSES.includes(n.status)).map((n) => n.key)),
    };
    return (
      <div className="col">
        <p className="hint">{C.adjustHint}</p>
        <TaskPlanEditor
          task={task}
          base={base}
          lock={lock}
          statuses={new Map(task.nodes.map((n) => [n.key, n.status]))}
          onDone={() => setAdjusting(false)}
        />
      </div>
    );
  }
  return (
    <div className="col">
      <PausedBanner task={task} pro={props.pro} onAdjust={() => setAdjusting(true)} />
      <StepsView {...props} />
    </div>
  );
}

/** The main area follows the task's state (14 §3.3). */
function TaskMain({ task, selection, pro }: MainProps) {
  const props = { task, selection, pro };
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
      return <PlanReview task={task} pro={pro} />;
    case TaskStatus.Running:
      return <StepsView {...props} />;
    case TaskStatus.Paused:
      return <PausedMain {...props} />;
    case TaskStatus.Failed:
      return (
        <div className="col">
          <FailurePanel task={task} />
          {task.nodes.length > 0 && <StepsView {...props} />}
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
              <StepsView {...props} />
            </details>
          )}
        </div>
      );
  }
}

export function TaskPage() {
  const { taskId } = route.useParams();
  const { node, details } = route.useSearch();
  const navigate = route.useNavigate();
  const task = useQuery(taskQuery(taskId));
  // The pro view: pro mode, or「显示详细信息」on this task in simple mode (D19).
  const isPro = useSettings()['ui.mode'] === UiMode.Pro;
  const pro = isPro || details === true;
  const selection: Selection = {
    selected: node,
    select: (id) => void navigate({ search: (prev) => ({ ...prev, node: id }), replace: true }),
    open: (id) => void navigate({ search: (prev) => ({ ...prev, node: id, open: true }) }),
  };
  const { open } = route.useSearch();
  if (task.isPending) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (task.isError) return <ErrorState error={task.error} onRetry={() => void task.refetch()} />;
  return (
    <div className="page wide" data-testid="task-page">
      <TaskHeader
        task={task.data}
        pro={pro}
        details={isPro ? undefined : details === true}
        onDetailsChange={(on) => void navigate({ search: (prev) => ({ ...prev, details: on }), replace: true })}
      />
      <TaskMain task={task.data} selection={selection} pro={pro} />
      <NodeDrawer
        taskId={taskId}
        nodeId={open === true ? node : undefined}
        pro={pro}
        onClose={() => void navigate({ search: (prev) => ({ ...prev, open: false }), replace: true })}
      />
    </div>
  );
}
