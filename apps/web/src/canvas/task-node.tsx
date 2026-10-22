import { type NodeStatus, STATUS_TONE } from '@aw/shared';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import type { MouseEvent } from 'react';
import { Icon } from '../components/icon.tsx';
import { CANVAS_COPY as C } from '../copy/plan-editor.ts';
import { NodeBadge } from '../features/tasks/task-badge.tsx';
import styles from './canvas.module.css';
import { useCanvasEdit } from './canvas-edit.ts';
import { classNames } from './canvas-util.ts';

/** What the canvas shows of a step; a planned step not yet created has no status. */
export type CanvasStep = {
  id: string;
  key: string;
  title: string;
  role: string;
  /** Keys of the steps this one depends on. */
  dependsOn: readonly string[];
  status?: NodeStatus;
  attemptCount?: number;
  /** The working attempt's progress line; shown instead of the description. */
  activity?: string | null;
  /** Third line when there is no progress: the first line of the instructions. */
  description?: string;
  /** Started steps of a plan being adjusted cannot change. */
  locked?: boolean;
};

export type TaskNodeData = { step: CanvasStep; selected: boolean };
export type PillNodeData = { label: string; done: boolean };
export type PlaceholderNodeData = { title: string; description: string };

const ROLE_COLOURS = 6;
/** The same role gets the same avatar colour on every canvas. */
function roleClass(role: string): string | undefined {
  const sum = [...role].reduce((total, ch) => total + (ch.codePointAt(0) ?? 0), 0);
  return styles[`role${(sum % ROLE_COLOURS) + 1}`];
}

const Handles = () => (
  <>
    <Handle type="target" position={Position.Left} className={styles.handle} isConnectable={false} />
    <Handle type="source" position={Position.Right} className={styles.handle} isConnectable={false} />
  </>
);

/** The + (menu: next step / parallel step) and − of an editable canvas; hidden when the edit would be invalid. */
function EditButtons({ id, title }: { id: string; title: string }) {
  const state = useCanvasEdit();
  if (state === undefined) return null;
  const { edit, menuFor, setMenuFor } = state;
  const canAfter = edit.canAddAfter(id);
  const canParallel = edit.canAddParallel(id);
  // The node's own click selects it; these buttons act on their own.
  const run = (action: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    action();
  };
  return (
    <>
      {(canAfter || canParallel) && (
        <button
          type="button"
          className={`${styles.plus} nodrag nopan`}
          aria-label={C.addMenu(title)}
          aria-expanded={menuFor === id}
          onClick={run(() => setMenuFor(menuFor === id ? undefined : id))}
        >
          <Icon name="plus" size="sm" />
        </button>
      )}
      {edit.canRemove(id) && (
        <button
          type="button"
          className={`${styles.minus} nodrag nopan`}
          aria-label={C.remove(title)}
          onClick={run(() => edit.remove(id))}
        >
          <Icon name="minus" size="sm" />
        </button>
      )}
      {menuFor === id && (
        <div className={`${styles.menu} nodrag nopan`} role="menu">
          {canAfter && (
            <button type="button" role="menuitem" onClick={run(() => edit.addAfter(id))}>
              <Icon name="plus" size="sm" />
              {C.addNext}
            </button>
          )}
          {canParallel && (
            <button type="button" role="menuitem" onClick={run(() => edit.addParallel(id))}>
              <Icon name="split" size="sm" />
              {C.addParallel}
            </button>
          )}
        </div>
      )}
    </>
  );
}

/**
 * A step card (26 §4): title and status, role, and progress or description, each one line with an ellipsis; the full
 * text is in the tooltip. Pure display: the canvas container handles input, the edit buttons call its edits.
 */
export function TaskNode({ id, data }: NodeProps & { data: TaskNodeData }) {
  const { step, selected } = data;
  const tone = step.status === undefined ? undefined : STATUS_TONE.node[step.status];
  const className = classNames(
    styles.node,
    tone !== undefined && styles[`tone-${tone}`],
    step.status !== undefined && styles[`status-${step.status}`],
    selected && styles.selected,
  );
  const third = step.activity ?? step.description ?? '';
  const full = [step.title, step.role, third].filter((t) => t !== '').join(' · ');
  return (
    <div className={className} title={full} data-testid={`step-${step.key}`}>
      <Handles />
      <div className={classNames(styles.row, styles.headRow)}>
        {step.locked === true && (
          <span className={styles.lock} role="img" aria-label={C.locked} title={C.locked}>
            <Icon name="lock" size="sm" />
          </span>
        )}
        <span className={styles.title}>{step.title}</span>
        {step.status !== undefined && <NodeBadge status={step.status} />}
      </div>
      <div className={styles.row}>
        <span className={classNames(styles.avatar, roleClass(step.role))} aria-hidden="true">
          {[...step.role][0]}
        </span>
        <span className={styles.role}>{step.role}</span>
        {step.attemptCount !== undefined && step.attemptCount > 1 && (
          <span className={styles.count}>×{step.attemptCount}</span>
        )}
      </div>
      <div className={styles.desc}>{third}</div>
      <EditButtons id={id} title={step.title} />
    </div>
  );
}

/** The start and end pills (26 §4.3). */
export function PillNode({ id, data }: NodeProps & { data: PillNodeData }) {
  return (
    <div className={classNames(styles.pill, data.done && styles.pillDone)} data-testid={`canvas-${id.slice(1)}`}>
      <Handles />
      <Icon name={data.done ? 'check' : 'play'} size="sm" />
      {data.label}
    </div>
  );
}

/** An AI workflow's shape: where the planner's steps go (26 §6.3). */
export function PlaceholderNode({ data }: NodeProps & { data: PlaceholderNodeData }) {
  return (
    <div className={styles.placeholder} title={data.description}>
      <Handles />
      <span className={styles.title}>{data.title}</span>
      <span className={styles.desc}>{data.description}</span>
    </div>
  );
}
