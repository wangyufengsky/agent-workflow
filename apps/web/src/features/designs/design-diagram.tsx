import '@xyflow/react/dist/base.css';
import {
  type DesignDiagramDTO,
  type DesignDiagramEdge,
  type DesignDiagramNode,
  DesignEvidenceClass,
  type DesignTransaction,
  layoutDesignDiagram,
} from '@aw/shared';
import {
  BaseEdge,
  type Edge,
  type EdgeProps,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import { type ReactNode, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import siteCopy from '../../copy/design-site.json';
import { DESIGN_WORKBENCH_COPY as C, DESIGN_DIAGRAM_LABEL } from '../../copy/design-workbench.ts';
import type { ReadingTarget } from './design-reading.ts';
import { TransactionTraces } from './design-transaction-traces.tsx';
import styles from './design-workbench.module.css';

type FigureNode = Node<
  {
    label: string;
    group?: string;
    summary?: string;
    action?: () => void;
    pressed?: boolean;
  },
  'designFigure'
>;
type FigureEdge = Edge<{ path: string }, 'designFigure'>;

function FigureNodeBody({ data }: NodeProps<FigureNode>) {
  const label = (
    <>
      <span>{data.label}</span>
      {data.group !== undefined && <small>{data.group}</small>}
    </>
  );
  return (
    <div className={styles.shape}>
      <Handle type="target" position={Position.Left} isConnectable={false} className={styles.handle} />
      {data.action === undefined ? (
        <span className={styles.figureLabel} title={data.summary}>
          {label}
        </span>
      ) : (
        <button
          type="button"
          className={`${styles.figureLabel} nodrag nopan`}
          title={data.summary}
          aria-pressed={data.pressed}
          onClick={data.action}
        >
          {label}
        </button>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} className={styles.handle} />
    </div>
  );
}

function FigureEdgeBody({ id, data, markerEnd, style }: EdgeProps<FigureEdge>) {
  if (data === undefined) return null;
  return (
    <BaseEdge
      id={id}
      path={data.path}
      {...(markerEnd === undefined ? {} : { markerEnd })}
      {...(style === undefined ? {} : { style })}
    />
  );
}
const nodeTypes = { designFigure: FigureNodeBody };
const edgeTypes = { designFigure: FigureEdgeBody };

type GraphProps = {
  diagram: DesignDiagramDTO;
  transaction?: DesignTransaction | undefined;
  targetOf: (node: DesignDiagramNode) => ReadingTarget | undefined;
  onNavigate: (target: ReadingTarget) => void;
  source: (path: string, line?: number, end?: number) => ReactNode;
};

function coordinates(
  diagram: DesignDiagramDTO,
  collapsed: ReadonlySet<string>,
  controlsFor: (node: DesignDiagramNode) => Pick<FigureNode['data'], 'action' | 'pressed'>,
  toggle: (group: string) => void,
): { nodes: FigureNode[]; edges: FigureEdge[] } {
  const visible = new Map<string, FigureNode['data']>();
  const projected = new Map<string, string>();
  const identifiers = new Set(diagram.nodes.map(({ id }) => id));
  const collapsedIds = new Map<string, string>();
  for (const node of diagram.nodes) {
    if (node.group !== undefined && collapsed.has(node.group)) {
      const group = node.group;
      let id = collapsedIds.get(group) ?? `group:${group}`;
      if (!collapsedIds.has(group)) {
        while (identifiers.has(id)) id = `:${id}`;
        identifiers.add(id);
        collapsedIds.set(group, id);
        visible.set(id, { label: group, action: () => toggle(group) });
      }
      projected.set(node.id, id);
      continue;
    }
    projected.set(node.id, node.id);
    visible.set(node.id, {
      label: node.label,
      ...(node.group === undefined ? {} : { group: node.group }),
      ...(node.summary === undefined ? {} : { summary: node.summary }),
      ...controlsFor(node),
    });
  }
  const projectedEdges = diagram.edges.flatMap((edge) => {
    const from = projected.get(edge.from);
    const to = projected.get(edge.to);
    if (from === undefined || to === undefined || (from === to && from !== edge.from)) return [];
    return [{ ...edge, from, to }];
  });
  const layout = layoutDesignDiagram(
    Array.from(visible.keys(), (id) => ({ id })),
    projectedEdges,
  );
  const routes = new Map(layout.routes.map(({ id, path }) => [id, path]));
  return {
    nodes: layout.placed.flatMap(({ id, box }) => {
      const data = visible.get(id);
      return data === undefined
        ? []
        : [
            {
              id,
              position: { x: box.x, y: box.y },
              width: box.width,
              height: box.height,
              type: 'designFigure' as const,
              // React Flow disables pointer events on non-draggable, non-selectable wrappers.
              ...(data.action === undefined ? {} : { style: { pointerEvents: 'auto' as const } }),
              data,
            },
          ];
    }),
    edges: projectedEdges.flatMap((edge) => {
      const path = routes.get(edge.id);
      const inference = edge.evidenceClass === DesignEvidenceClass.Inferred;
      return path === undefined
        ? []
        : [
            {
              id: edge.id,
              source: edge.from,
              target: edge.to,
              type: 'designFigure' as const,
              data: { path },
              markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--muted)' },
              style: { stroke: 'var(--muted)', strokeWidth: 1.5, ...(inference ? { strokeDasharray: '5 4' } : {}) },
            },
          ];
    }),
  };
}

function evidenceLabel(edge: DesignDiagramEdge): string {
  return edge.evidenceClass === DesignEvidenceClass.Static ? C.static : C.inferred;
}

function Board({ diagram, targetOf, onNavigate, source, transaction }: GraphProps) {
  const { zoomIn, zoomOut, fitView } = useReactFlow<FigureNode, FigureEdge>();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [hovered, setHovered] = useState<string>();
  const [pinned, setPinned] = useState<string>();
  const described = diagram.edges.find(({ id }) => id === (pinned ?? hovered));
  const groups = [...new Set(diagram.nodes.flatMap(({ group }) => (group === undefined ? [] : [group])))];
  const toggle = (group: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  const [stepId, selectStep] = useState<string>();
  const step = diagram.nodes.find((node) => node.id === stepId && !collapsed.has(node.group ?? ''));
  const stepTarget = step === undefined ? undefined : targetOf(step);
  const { nodes, edges } = coordinates(
    diagram,
    collapsed,
    (node) => {
      if (transaction)
        return { pressed: node.id === step?.id, action: () => selectStep(node.id === stepId ? undefined : node.id) };
      const target = targetOf(node);
      return target === undefined ? {} : { action: () => onNavigate(target) };
    },
    toggle,
  );
  return (
    <>
      <div className={styles.graphToolbar}>
        <span className="hint">{DESIGN_DIAGRAM_LABEL[diagram.kind]}</span>
        {groups.length > 0 && (
          <fieldset className={`row wrap ${styles.graphGroups}`} aria-label={C.groups}>
            {groups.map((group) => (
              <Button
                key={group}
                size="sm"
                variant="ghost"
                aria-pressed={!collapsed.has(group)}
                onClick={() => toggle(group)}
              >
                <IconGroup collapsed={collapsed.has(group)} />
                {group}
              </Button>
            ))}
          </fieldset>
        )}
        <span className="grow" />
        <Button size="sm" aria-label={C.zoomOut} icon="minus" onClick={() => void zoomOut()} />
        <Button size="sm" aria-label={C.zoomIn} icon="plus" onClick={() => void zoomIn()} />
        <Button size="sm" aria-label={C.fit} icon="expand" onClick={() => void fitView({ padding: 0.2 })} />
      </div>
      <section className={styles.graph} aria-label={diagram.title}>
        <ReactFlow<FigureNode, FigureEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          onEdgeMouseEnter={(_event, edge) => setHovered(edge.id)}
          onEdgeMouseLeave={() => setHovered(undefined)}
          onEdgeClick={(_event, edge) => setPinned((current) => (current === edge.id ? undefined : edge.id))}
          elementsSelectable={false}
          zoomOnDoubleClick={false}
          zoomOnScroll={false}
          panOnDrag
          preventScrolling={false}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
        />
        {described !== undefined && (
          <aside className={styles.graphEvidence} aria-label={C.edgeEvidence} data-pinned={pinned !== undefined}>
            <div className="row wrap">
              <strong>{described.label ?? described.kind}</strong>
              <span className={styles.sourceTag}>{evidenceLabel(described)}</span>
              <span className="grow" />
              {pinned !== undefined && (
                <Button
                  size="sm"
                  icon="x"
                  variant="ghost"
                  aria-label={COMMON_COPY.close}
                  onClick={() => {
                    setPinned(undefined);
                    setHovered(undefined);
                  }}
                />
              )}
            </div>
            {described.evidencePath !== undefined &&
              source(described.evidencePath, described.lineStart, described.lineEnd)}
            {described.rationale !== undefined && <p className="hint">{described.rationale}</p>}
          </aside>
        )}
      </section>
      {step !== undefined && (
        <aside className={styles.proseBlock} aria-label={siteCopy.transactions.steps}>
          <strong>{step.label}</strong>
          {step.group && <span className={styles.sourceTag}>{step.group}</span>}
          {step.summary && <p>{step.summary}</p>}
          {stepTarget !== undefined ? (
            <button type="button" className={styles.textButton} onClick={() => onNavigate(stepTarget)}>
              {siteCopy.transactions.source}
            </button>
          ) : (
            step.relPath && source(step.relPath)
          )}
        </aside>
      )}
    </>
  );
}

function IconGroup({ collapsed }: { collapsed: boolean }) {
  return <span aria-hidden="true">{collapsed ? '+' : '−'}</span>;
}

export function DesignDiagram({ diagram, targetOf, onNavigate, source, transaction }: GraphProps) {
  const nodes = new Map(diagram.nodes.map((node) => [node.id, node]));
  const endpoint = (id: string) => {
    const node = nodes.get(id);
    if (node === undefined) return id;
    const target = targetOf(node);
    return target === undefined ? (
      node.label
    ) : (
      <button type="button" className={styles.textButton} onClick={() => onNavigate(target)}>
        {node.label}
      </button>
    );
  };
  return (
    <div className={styles.figure}>
      {diagram.nodes.length === 0 ? (
        <p className="hint">{C.noNodes}</p>
      ) : (
        <ReactFlowProvider>
          <Board
            transaction={transaction}
            diagram={diagram}
            targetOf={targetOf}
            onNavigate={onNavigate}
            source={source}
          />
        </ReactFlowProvider>
      )}
      {transaction && <TransactionTraces transaction={transaction} diagram={diagram} source={source} />}
      <details className={styles.edgeList}>
        <summary>{C.textEdges}</summary>
        {diagram.edges.length === 0 ? (
          <p className="hint">{C.noEdges}</p>
        ) : (
          <ul>
            {diagram.edges.map((edge) => (
              <li key={edge.id}>
                <div className="row wrap">
                  {endpoint(edge.from)} <span aria-hidden="true">→</span> {edge.label ?? edge.kind}
                  <span aria-hidden="true">→</span> {endpoint(edge.to)}
                  <span className={styles.sourceTag}>{evidenceLabel(edge)}</span>
                  {edge.evidencePath !== undefined && source(edge.evidencePath, edge.lineStart, edge.lineEnd)}
                </div>
                {edge.rationale !== undefined && <p className="hint">{edge.rationale}</p>}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
