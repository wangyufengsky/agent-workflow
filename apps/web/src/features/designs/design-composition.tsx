import '@xyflow/react/dist/base.css';
import { layoutDesignDiagram } from '@aw/shared';
import { Handle, type Node, type NodeProps, Position, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { Button } from '../../components/button.tsx';
import { DESIGN_WORKBENCH_COPY as C } from '../../copy/design-workbench.ts';
import type { ReadingTarget } from './design-reading.ts';
import styles from './design-workbench.module.css';

export type CompositionItem = { id: string; title: string; detail: string; target?: ReadingTarget };
type CompositionNode = Node<{ item: CompositionItem; root?: boolean; activate?: () => void }, 'designComposition'>;

function CompositionNodeBody({ data }: NodeProps<CompositionNode>) {
  const label = (
    <>
      <strong>{data.item.title}</strong>
      <small>{data.item.detail}</small>
    </>
  );
  return (
    <div className={styles.compositionNode} data-root={data.root}>
      <Handle type="target" position={Position.Top} isConnectable={false} className={styles.handle} />
      {data.activate === undefined ? (
        <span>{label}</span>
      ) : (
        <button type="button" className="nodrag nopan" aria-label={data.item.title} onClick={data.activate}>
          {label}
        </button>
      )}
      <Handle type="source" position={Position.Bottom} isConnectable={false} className={styles.handle} />
    </div>
  );
}

const nodeTypes = { designComposition: CompositionNodeBody };

type Props = {
  title: string;
  parent: CompositionItem;
  items: CompositionItem[];
  onNavigate: (target: ReadingTarget) => void;
};

const NODE_WIDTH = 192;
const NODE_HEIGHT = 58;
const HORIZONTAL_STEP = 216;
const VERTICAL_STEP = 106;
const MAX_COLUMNS = 3;

function CompositionBoard({ title, parent, items, onNavigate }: Props) {
  const { fitView, zoomIn, zoomOut } = useReactFlow<CompositionNode>();
  const links = items.map(({ id }) => ({ id, from: parent.id, to: id }));
  const layout = layoutDesignDiagram([parent, ...items], links);
  const rank = new Map(layout.placed.map(({ id, box }) => [id, box.y]));
  const ordered = [...items].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  const middle = (Math.min(MAX_COLUMNS, ordered.length) * HORIZONTAL_STEP - NODE_WIDTH) / 2;
  const nodes: CompositionNode[] = [
    {
      id: parent.id,
      type: 'designComposition',
      position: { x: middle, y: 0 },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      data: { item: parent, root: true },
    },
    ...ordered.map((item, index): CompositionNode => {
      const row = Math.floor(index / MAX_COLUMNS);
      const visible = Math.min(MAX_COLUMNS, ordered.length - row * MAX_COLUMNS);
      const x = ((index % MAX_COLUMNS) - (visible - 1) / 2) * HORIZONTAL_STEP + middle;
      const { target } = item;
      return {
        id: item.id,
        type: 'designComposition',
        position: { x, y: (row + 1) * VERTICAL_STEP },
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        ...(target === undefined ? {} : { style: { pointerEvents: 'auto' } }),
        data: { item, ...(target === undefined ? {} : { activate: () => onNavigate(target) }) },
      };
    }),
  ];
  return (
    <div className={styles.compositionPanel}>
      <div className={styles.compositionTools}>
        <span className="grow" />
        <Button size="sm" aria-label={C.zoomOut} icon="minus" onClick={() => void zoomOut()} />
        <Button size="sm" aria-label={C.zoomIn} icon="plus" onClick={() => void zoomIn()} />
        <Button size="sm" onClick={() => void fitView({ padding: 0.22 })}>
          {C.fit}
        </Button>
      </div>
      <section
        className={`${styles.graph} ${styles.compositionGraph}`}
        aria-label={title}
        data-compact={items.length < 4 || undefined}
      >
        <ReactFlow
          nodes={nodes}
          edges={links.map(({ id, from, to }) => ({
            id,
            source: from,
            target: to,
            type: 'smoothstep',
            style: { stroke: 'var(--muted)' },
          }))}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.22, maxZoom: 1 }}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
        />
      </section>
      <div className={styles.compositionLegend}>
        <span>{C.graphContains}</span>
        <span>{C.graphControls}</span>
      </div>
    </div>
  );
}

export function DesignComposition(props: Props) {
  return props.items.length === 0 ? (
    <p className="hint">{C.noStructure}</p>
  ) : (
    <ReactFlowProvider>
      <CompositionBoard {...props} />
    </ReactFlowProvider>
  );
}
