import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from '@xyflow/react';
import { Icon } from '../components/icon.tsx';
import { CANVAS_COPY as C } from '../copy/plan-editor.ts';
import styles from './canvas.module.css';
import { useCanvasEdit } from './canvas-edit.ts';

/** A dependency line; on an editable canvas its midpoint has a + that inserts a step there (26 §5.1). */
export function StepEdge({
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const state = useCanvasEdit();
  return (
    <>
      <BaseEdge path={path} interactionWidth={0} />
      {state?.edit.canInsert(source, target) === true && (
        <EdgeLabelRenderer>
          <div
            className={styles.insertAt}
            // Positioned by React Flow's edge-label layer, in graph coordinates.
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            <button
              type="button"
              className={`${styles.insert} nodrag nopan`}
              aria-label={C.insert(state.titleOf(source), state.titleOf(target))}
              data-testid={`insert-${source}-${target}`}
              onClick={() => state.edit.insert(source, target)}
            >
              <Icon name="plus" size="sm" />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
