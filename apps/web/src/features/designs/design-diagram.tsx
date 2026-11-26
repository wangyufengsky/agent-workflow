import '@xyflow/react/dist/base.css';
import {
  type DesignDiagramDTO,
  type DesignDiagramEdge,
  type DesignDiagramLayout,
  type DesignDiagramNode,
  DesignEvidenceClass,
  type DesignFileDTO,
  type DesignTransaction,
  layoutDesignDiagram,
  presentTransactionDiagram,
  type TransactionNodeRole,
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
  useNodesInitialized,
  useReactFlow,
} from '@xyflow/react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { Icon } from '../../components/icon.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import siteCopy from '../../copy/design-site.json';
import { DESIGN_WORKBENCH_COPY as C, DESIGN_DIAGRAM_LABEL } from '../../copy/design-workbench.ts';
import type { ReadingTarget } from './design-reading.ts';
import styles from './design-workbench.module.css';

type FigureNode = Node<
  {
    label: string;
    group?: string;
    summary?: string;
    role?: TransactionNodeRole;
    detail?: string;
    action?: () => void;
    pressed?: boolean;
  },
  'designFigure'
>;
type FigureEdge = Edge<
  {
    path: string;
    label?: { text: string; x: number; y: number; width: number };
  },
  'designFigure'
>;

function FigureNodeBody({ data }: NodeProps<FigureNode>) {
  const label = (
    <>
      <span>{data.label}</span>
      {data.group !== undefined && <small>{data.group}</small>}
    </>
  );
  return (
    <div className={data.role ? styles.txShape : styles.shape}>
      <Handle type="target" position={Position.Left} isConnectable={false} className={styles.handle} />
      {data.action === undefined ? (
        <span className={styles.figureLabel} title={data.summary}>
          {label}
        </span>
      ) : (
        <button
          type="button"
          className={`${data.role ? 'tx-node' : styles.figureLabel} nodrag nopan`}
          data-kind={data.role}
          aria-label={data.role ? data.label : undefined}
          title={data.summary}
          aria-pressed={data.pressed}
          onClick={data.action}
        >
          {data.role ? (
            <>
              <Icon name={data.role === 'exception' ? 'alert' : data.role === 'external' ? 'external' : 'flow'} />
              <strong>{data.label}</strong>
              {data.detail && <code>{data.detail}</code>}
            </>
          ) : (
            label
          )}
        </button>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} className={styles.handle} />
    </div>
  );
}

function FigureEdgeBody({ id, data, markerEnd, style }: EdgeProps<FigureEdge>) {
  if (data === undefined) return null;
  return (
    <>
      <BaseEdge
        id={id}
        path={data.path}
        {...(markerEnd === undefined ? {} : { markerEnd })}
        {...(style === undefined ? {} : { style })}
      />
      {data.label && (
        <foreignObject
          x={data.label.x - data.label.width / 2}
          y={data.label.y - 8}
          width={data.label.width}
          height={16}
          pointerEvents="none"
        >
          <span className={styles.txEdgeLabel}>{data.label.text}</span>
        </foreignObject>
      )}
    </>
  );
}
const nodeTypes = { designFigure: FigureNodeBody };
const edgeTypes = { designFigure: FigureEdgeBody };

export type GraphProps = {
  diagram: DesignDiagramDTO;
  targetOf: (node: DesignDiagramNode) => ReadingTarget | undefined;
  onNavigate: (target: ReadingTarget) => void;
  source: (path: string, line?: number, end?: number) => ReactNode;
};

type TransactionProjection = ReturnType<typeof presentTransactionDiagram>;
type TransactionPlot = {
  profile: DesignTransaction;
  files: DesignFileDTO[];
  projection: TransactionProjection;
  selected: string | undefined;
  select: (id: string) => void;
};

function coordinates(
  diagram: DesignDiagramDTO,
  collapsed: ReadonlySet<string>,
  controlsFor: (node: DesignDiagramNode) => Pick<FigureNode['data'], 'action' | 'pressed'>,
  toggle: (group: string) => void,
  transaction: TransactionPlot | undefined,
): { nodes: FigureNode[]; edges: FigureEdge[]; layout: DesignDiagramLayout } {
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
  const original = new Map(diagram.nodes.map((node) => [node.id, node]));
  const shown = Array.from(visible, ([id, data]) => original.get(id) ?? { id, label: data.label });
  const projection =
    transaction &&
    (collapsed.size
      ? presentTransactionDiagram(shown, projectedEdges, transaction.files, transaction.profile)
      : transaction.projection);
  const layout = projection?.layout ?? layoutDesignDiagram(shown, projectedEdges);
  const routes = new Map(layout.routes.map((route) => [route.id, route]));
  const labels = new Map(projection?.nodes.map((node) => [node.id, node]));
  const roles = new Map(projection?.edges.map((edge) => [edge.id, edge.role]));
  return {
    layout,
    nodes: layout.placed.flatMap(({ id, box }) => {
      const data = visible.get(id);
      const label = labels.get(id);
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
              data: label ? { ...data, label: label.title, detail: label.detail, role: label.role } : data,
            },
          ];
    }),
    edges: projectedEdges.flatMap((edge) => {
      const route = routes.get(edge.id);
      const exception = roles.get(edge.id) === 'exception';
      const stroke = projection ? (exception ? 'var(--tx-exception)' : 'var(--tx-edge)') : 'var(--muted)';
      const inference = edge.evidenceClass === DesignEvidenceClass.Inferred;
      return route === undefined
        ? []
        : [
            {
              id: edge.id,
              source: edge.from,
              target: edge.to,
              type: 'designFigure' as const,
              data: {
                path: route.path,
                ...(projection
                  ? {
                      label: {
                        x: route.labelX,
                        y: route.labelY,
                        width: route.labelWidth,
                        text: edge.label ?? edge.kind,
                      },
                    }
                  : {}),
              },
              markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
              style: {
                stroke,
                strokeWidth: 1.5,
                ...(exception || inference ? { strokeDasharray: exception ? '6 4' : '2 4' } : {}),
              },
            },
          ];
    }),
  };
}

function evidenceLabel(edge: DesignDiagramEdge): string {
  return edge.evidenceClass === DesignEvidenceClass.Static ? C.static : C.inferred;
}

export function DiagramBoard({
  diagram,
  targetOf,
  onNavigate,
  source,
  transaction,
}: GraphProps & { transaction?: TransactionPlot }) {
  const nodesInitialized = useNodesInitialized();
  const { zoomIn, zoomOut, fitView, fitBounds, getViewport, setCenter, viewportInitialized } = useReactFlow<
    FigureNode,
    FigureEdge
  >();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [hovered, setHovered] = useState<string>();
  const [pinned, setPinned] = useState<string>();
  const described = diagram.edges.find(({ id }) => id === (pinned ?? hovered));
  const groups = [...new Set(diagram.nodes.flatMap(({ group }) => (group === undefined ? [] : [group])))];
  const toggle = useCallback(
    (group: string) =>
      setCollapsed((previous) => {
        const next = new Set(previous);
        if (next.has(group)) next.delete(group);
        else next.add(group);
        return next;
      }),
    [],
  );
  const { nodes, edges, layout } = useMemo(
    () =>
      coordinates(
        diagram,
        collapsed,
        (node) => {
          if (transaction)
            return { pressed: node.id === transaction.selected, action: () => transaction.select(node.id) };
          const target = targetOf(node);
          return target === undefined ? {} : { action: () => onNavigate(target) };
        },
        toggle,
        transaction,
      ),
    [diagram, collapsed, transaction, targetOf, onNavigate, toggle],
  );
  const plot = useRef<HTMLElement>(null);
  const selectedNode = transaction && diagram.nodes.find((node) => node.id === transaction.selected);
  useEffect(() => {
    const group = selectedNode?.group;
    if (group === undefined) return;
    setCollapsed((previous) => {
      if (!previous.has(group)) return previous;
      const next = new Set(previous);
      next.delete(group);
      return next;
    });
  }, [selectedNode]);
  const stepBox = selectedNode && layout.placed.find(({ id }) => id === selectedNode.id)?.box;
  useEffect(() => {
    if (!stepBox || !plot.current || !nodesInitialized || !viewportInitialized) return;
    const { x, y, zoom } = getViewport();
    const left = stepBox.x * zoom + x;
    const top = stepBox.y * zoom + y;
    if (
      left < 0 ||
      top < 0 ||
      left + stepBox.width * zoom > plot.current.clientWidth ||
      top + stepBox.height * zoom > plot.current.clientHeight
    )
      void setCenter(stepBox.x + stepBox.width / 2, stepBox.y + stepBox.height / 2, { zoom });
  }, [stepBox, getViewport, setCenter, nodesInitialized, viewportInitialized]);
  const groupControls = groups.length > 0 && (
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
  );
  return (
    <>
      <div className={transaction ? 'tx-toolbar' : styles.graphToolbar}>
        {transaction ? (
          <div>
            <h3>{diagram.title}</h3>
            <small>
              {siteCopy.transactions.graphSize
                .replace('{nodes}', String(diagram.nodes.length))
                .replace('{edges}', String(diagram.edges.length))}
            </small>
          </div>
        ) : (
          <span className="hint">{DESIGN_DIAGRAM_LABEL[diagram.kind]}</span>
        )}
        {transaction && groups.length > 0 ? (
          <details className={styles.txGroups}>
            <summary className={styles.txGroupSummary}>{C.groups}</summary>
            {groupControls}
          </details>
        ) : (
          groupControls
        )}
        <span className="grow" />
        <Button size="sm" aria-label={C.zoomOut} icon="minus" onClick={() => void zoomOut()} />
        <Button size="sm" aria-label={C.zoomIn} icon="plus" onClick={() => void zoomIn()} />
        <Button
          size="sm"
          aria-label={C.fit}
          icon="expand"
          onClick={() => {
            if (transaction)
              void fitBounds({ x: 0, y: 0, width: layout.width, height: layout.height }, { padding: 0.12 });
            else void fitView({ padding: 0.2 });
          }}
        />
      </div>
      <section
        ref={plot}
        className={transaction ? `tx-plot ${styles.txPlot}` : styles.graph}
        aria-label={diagram.title}
      >
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
          {...(transaction ? { minZoom: 0.02 } : {})}
          fitViewOptions={{ padding: 0.2, maxZoom: 1, ...(transaction ? { minZoom: 0.65 } : {}) }}
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
    </>
  );
}

function IconGroup({ collapsed }: { collapsed: boolean }) {
  return <span aria-hidden="true">{collapsed ? '+' : '−'}</span>;
}

export function EdgeList({ diagram, targetOf, onNavigate, source }: GraphProps) {
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
  );
}

export function DesignDiagram(props: GraphProps) {
  return (
    <div className={styles.figure}>
      {props.diagram.nodes.length === 0 ? (
        <p className="hint">{C.noNodes}</p>
      ) : (
        <ReactFlowProvider>
          <DiagramBoard {...props} />
        </ReactFlowProvider>
      )}
      <EdgeList {...props} />
    </div>
  );
}
