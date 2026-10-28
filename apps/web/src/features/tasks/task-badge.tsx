import { type NodeStatus, STATUS_TONE, StatusTone, type TaskDisplayGroup } from '@aw/shared';
import { StatusBadge } from '../../components/status-badge.tsx';
import { NODE_STATUS_LABEL, TASK_ARCHIVED_LABEL, TASK_DISPLAY_LABEL } from '../../copy/tasks.ts';

/** The task's display state, and「已归档」beside it when `archived` (D219). */
export function TaskBadge({ group, archived = false }: { group: TaskDisplayGroup; archived?: boolean }) {
  return (
    <>
      <StatusBadge tone={STATUS_TONE.taskDisplay[group]} label={TASK_DISPLAY_LABEL[group]} />
      {archived && <StatusBadge tone={StatusTone.Idle} label={TASK_ARCHIVED_LABEL} />}
    </>
  );
}

export function NodeBadge({ status }: { status: NodeStatus }) {
  return <StatusBadge tone={STATUS_TONE.node[status]} label={NODE_STATUS_LABEL[status]} />;
}
