import type { TaskSummaryDTO } from '@aw/shared';
import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { formatDateTime } from '../../copy/common.ts';
import { TaskBadge } from './task-badge.tsx';
import styles from './tasks.module.css';

/** A task on one line (14 §3.2, D119): title, key, project and workflow, display state, last update. */
export function TaskRow({ task }: { task: TaskSummaryDTO }) {
  return (
    <Link to={ROUTES.task} params={{ taskId: task.id }} className={`list-row ${styles.row}`} data-testid="task-row">
      <span className={`ellipsis ${styles.rowTitle}`}>{task.title}</span>
      <span className={`hint ellipsis grow ${styles.rowMeta}`}>
        <span className="mono">{task.key}</span> · {task.project.name} · {task.workflow.name}
      </span>
      <TaskBadge group={task.displayGroup} />
      <span className={`hint ${styles.rowTime}`}>{formatDateTime(task.updatedAt)}</span>
    </Link>
  );
}
