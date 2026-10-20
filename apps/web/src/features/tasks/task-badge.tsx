import { type NodeStatus, STATUS_TONE, type TaskDisplayGroup } from '@aw/shared';
import { StatusBadge } from '../../components/status-badge.tsx';
import { NODE_STATUS_LABEL, TASK_DISPLAY_LABEL } from '../../copy/tasks.ts';

export function TaskBadge({ group }: { group: TaskDisplayGroup }) {
  return <StatusBadge tone={STATUS_TONE.taskDisplay[group]} label={TASK_DISPLAY_LABEL[group]} />;
}

export function NodeBadge({ status }: { status: NodeStatus }) {
  return <StatusBadge tone={STATUS_TONE.node[status]} label={NODE_STATUS_LABEL[status]} />;
}
