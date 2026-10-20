import type { TaskSummaryDTO } from '@aw/shared';
import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { TaskBadge } from './task-badge.tsx';

/** A task in a list: title, project and workflow, display state and what it is doing now. */
export function TaskCard({ task }: { task: TaskSummaryDTO }) {
  const activity = task.progress ?? task.currentStep;
  return (
    <Link to={ROUTES.task} params={{ taskId: task.id }} className="card pad col" data-testid="task-card">
      <span className="row">
        <span className="section-title grow ellipsis">{task.title}</span>
        <TaskBadge group={task.displayGroup} />
      </span>
      <span className="hint ellipsis">
        <span className="mono">{task.key}</span> · {task.project.name} · {task.workflow.name}
      </span>
      {activity !== null && <span className="sub ellipsis">{activity}</span>}
    </Link>
  );
}
