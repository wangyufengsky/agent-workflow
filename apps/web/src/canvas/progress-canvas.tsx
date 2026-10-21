import '@xyflow/react/dist/base.css';
import { NodeStatus } from '@aw/shared';
import { type Edge, MiniMap, type Node, ReactFlow, ReactFlowProvider, useReactFlow, useStore } from '@xyflow/react';
import { useEffect, useMemo, useRef } from 'react';
import styles from './canvas.module.css';
import { type CanvasStep, TaskNode, type TaskNodeData } from './task-node.tsx';
import { useGraphLayout } from './use-graph-layout.ts';
import { useNodeSizes } from './use-node-sizes.ts';

const NODE_TYPES = { task: TaskNode };
/** The minimap helps only for larger graphs (14 §5). */
const MINIMAP_FROM = 12;
const FINISHED: readonly NodeStatus[] = [NodeStatus.Done, NodeStatus.Skipped];
/** Fitting never zooms out further than this: past it node titles are unreadable; the user pans instead. */
const FIT = { padding: 0.15, minZoom: 0.6, maxZoom: 1 };

type Props = {
  steps: readonly CanvasStep[];
  selectedId?: string | undefined;
  onSelect?: (id: string) => void;
  onOpen?: (id: string) => void;
};

function Flow({ steps, selectedId, onSelect, onOpen }: Props) {
  const { fitView } = useReactFlow();
  const fitted = useRef(false);
  const idOf = useMemo(() => new Map(steps.map((s) => [s.key, s.id])), [steps]);
  const edges = useMemo<Edge[]>(
    () =>
      steps.flatMap((step) =>
        step.dependsOn.flatMap((key) => {
          const source = idOf.get(key);
          if (source === undefined) return [];
          const from = steps.find((s) => s.id === source);
          const done = from?.status !== undefined && FINISHED.includes(from.status);
          // Finished upstream: solid highlighted line; otherwise dashed (14 §5).
          return [
            {
              id: `${source}->${step.id}`,
              source,
              target: step.id,
              style: done ? { stroke: 'var(--edge-done)' } : { stroke: 'var(--edge)', strokeDasharray: '6 6' },
            },
          ];
        }),
      ),
    [steps, idOf],
  );
  const positions = useGraphLayout({ nodes: steps, edges });

  // Fit the first layout once React Flow has measured a visible canvas (it may start folded away); afterwards keep
  // the user's view.
  const measured = useStore((state) => state.width > 0 && state.height > 0);
  useEffect(() => {
    if (fitted.current || !measured || positions.size === 0) return;
    fitted.current = true;
    requestAnimationFrame(() => void fitView(FIT));
  }, [measured, positions, fitView]);

  const { onNodesChange, measured: sizeOf } = useNodeSizes();
  const nodes = useMemo<Node<TaskNodeData>[]>(
    () =>
      steps.map((step) => ({
        id: step.id,
        type: 'task',
        position: positions.get(step.id) ?? { x: 0, y: 0 },
        data: { step, selected: step.id === selectedId },
        draggable: false,
        connectable: false,
        ...sizeOf(step.id),
      })),
    [steps, positions, selectedId, sizeOf],
  );

  return (
    <ReactFlow
      nodes={nodes}
      onNodesChange={onNodesChange}
      edges={edges}
      nodeTypes={NODE_TYPES}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      onNodeClick={(_e, node) => onSelect?.(node.id)}
      onNodeDoubleClick={(_e, node) => onOpen?.(node.id)}
      // Double-click opens a step (14 §5), it does not zoom.
      zoomOnDoubleClick={false}
      proOptions={{ hideAttribution: true }}
      minZoom={0.3}
      maxZoom={1.5}
    >
      {steps.length > MINIMAP_FROM && <MiniMap pannable zoomable />}
    </ReactFlow>
  );
}

/** Read-only progress canvas (14 §5): React Flow with an elkjs layout. */
export function ProgressCanvas(props: Props) {
  return (
    <div className={styles.canvas} data-testid="progress-canvas">
      <ReactFlowProvider>
        <Flow {...props} />
      </ReactFlowProvider>
    </div>
  );
}
