import { type NodeStatus, STATUS_TONE } from '@aw/shared';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { NodeBadge } from '../features/tasks/task-badge.tsx';
import styles from './canvas.module.css';

/** What the canvas shows of a step; a planned step not yet created has no status. */
export type CanvasStep = {
  id: string;
  key: string;
  title: string;
  role: string;
  dependsOn: readonly string[];
  status?: NodeStatus;
  attemptCount?: number;
  activity?: string | null;
};

export type TaskNodeData = { step: CanvasStep; selected: boolean };

/** `taskNode` (14 §5): title, role, status and the current activity line. Pure display; the canvas handles input. */
export function TaskNode({ data }: NodeProps & { data: TaskNodeData }) {
  const { step, selected } = data;
  const tone = step.status === undefined ? undefined : STATUS_TONE.node[step.status];
  const className = [styles.node, tone === undefined ? '' : styles[`tone-${tone}`], selected ? styles.selected : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={className} data-testid={`step-${step.key}`}>
      <Handle type="target" position={Position.Left} className={styles.handle} isConnectable={false} />
      <div className={styles.top}>
        <span className={styles.title}>{step.title}</span>
        {step.status !== undefined && <NodeBadge status={step.status} />}
      </div>
      <div className={styles.meta}>
        <span>{step.role}</span>
        {step.attemptCount !== undefined && step.attemptCount > 1 && (
          <span className={styles.count}>×{step.attemptCount}</span>
        )}
        {step.activity !== undefined && step.activity !== null && <span>{step.activity}</span>}
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} isConnectable={false} />
    </div>
  );
}
