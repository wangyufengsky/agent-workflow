import { FlowNodeShape } from '@aw/shared';
import { useId } from 'react';
import styles from './charts.module.css';
import { FLOW_LOOP_LANE, type FlowBox, layoutFlow } from './flow-layout.ts';

export type FlowNode = { id: string; label: string; shape?: FlowNodeShape | undefined };
export type FlowEdge = { from: string; to: string; label?: string | undefined };

/** An edge as drawn: its path and where its label sits. */
type Line = { edge: FlowEdge; back: boolean; d: string; labelAt: { x: number; y: number } };

/** Gap between an arrow's tip and the node it points at. */
const ARROW_GAP = 2;
const STEP_RADIUS = 8;

function Shape({ shape, box }: { shape: FlowNodeShape; box: FlowBox }) {
  const { x, y, width, height } = box;
  if (shape === FlowNodeShape.Decision) {
    const points = [
      [x + width / 2, y],
      [x + width, y + height / 2],
      [x + width / 2, y + height],
      [x, y + height / 2],
    ];
    return <polygon className={styles.shape} data-shape={shape} points={points.map((p) => p.join(',')).join(' ')} />;
  }
  if (shape === FlowNodeShape.Terminal) {
    return (
      <rect className={styles.shape} data-shape={shape} x={x} y={y} width={width} height={height} rx={height / 2} />
    );
  }
  // A step is a card with an accent bar down its left edge.
  return (
    <g>
      <rect className={styles.shape} data-shape={shape} x={x} y={y} width={width} height={height} rx={STEP_RADIUS} />
      <rect className={styles.stepBar} x={x + 4} y={y + 10} width={3} height={height - 20} rx={1.5} />
    </g>
  );
}

/**
 * A static flowchart, top to bottom (35 §5.3): shapes and edges in SVG, labels in HTML; an edge looping back runs
 * dashed in a lane right of the nodes. Wider than its box, it scrolls inside it. A visually hidden list reads the
 * steps and edges out.
 */
export function FlowChart({
  label,
  nodes,
  edges,
  shapeName,
  describeEdge,
  nodesCaption,
  edgesCaption,
}: {
  label: string;
  nodes: readonly FlowNode[];
  edges: readonly FlowEdge[];
  shapeName: (shape: FlowNodeShape) => string;
  describeEdge: (from: string, to: string, label: string | undefined) => string;
  nodesCaption: string;
  edgesCaption: string;
}) {
  // An id usable inside url(#…): React's ids carry characters a fragment reference does not take.
  const arrow = `flow-arrow-${useId().replace(/[^A-Za-z0-9]/g, '')}`;
  const layout = layoutFlow(nodes, edges);
  const boxOf = new Map(layout.placed.map((p) => [p.node.id, p.box]));
  const labelOf = new Map(nodes.map((n) => [n.id, n.label]));
  const lines = layout.edges.flatMap(({ edge, back, lane }): Line[] => {
    const from = boxOf.get(edge.from);
    const to = boxOf.get(edge.to);
    // The checks keep edges between known nodes (checkFlowchart).
    if (from === undefined || to === undefined) return [];
    if (back) {
      const laneX = layout.laneX + lane * FLOW_LOOP_LANE + FLOW_LOOP_LANE / 2;
      const fromY = from.y + from.height / 2;
      const toY = to.y + to.height / 2;
      return [
        {
          edge,
          back,
          d: `M ${from.x + from.width} ${fromY} H ${laneX} V ${toY} H ${to.x + to.width + ARROW_GAP}`,
          labelAt: { x: laneX, y: (fromY + toY) / 2 },
        },
      ];
    }
    const x1 = from.x + from.width / 2;
    const y1 = from.y + from.height;
    const x2 = to.x + to.width / 2;
    const y2 = to.y - ARROW_GAP;
    const bend = (y2 - y1) / 2;
    return [
      {
        edge,
        back,
        d: `M ${x1} ${y1} C ${x1} ${y1 + bend} ${x2} ${y2 - bend} ${x2} ${y2}`,
        labelAt: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
      },
    ];
  });

  return (
    <figure className={styles.chart} aria-label={label}>
      <div className={styles.flowScroll}>
        <div className={styles.flow} style={{ width: layout.width, height: layout.height }} aria-hidden="true">
          <svg width={layout.width} height={layout.height} aria-hidden="true">
            <defs>
              <marker id={arrow} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path className={styles.arrow} d="M 0 0 L 8 4 L 0 8 z" />
              </marker>
            </defs>
            {lines.map((line) => (
              <path
                key={`${line.edge.from}-${line.edge.to}`}
                className={styles.edge}
                data-back={line.back ? '' : undefined}
                d={line.d}
                markerEnd={`url(#${arrow})`}
              />
            ))}
            {/* Light moving along the forward edges shows which way the flow goes. */}
            {lines.map((line) =>
              line.back ? null : <path key={`${line.edge.from}-${line.edge.to}`} className={styles.pulse} d={line.d} />,
            )}
            {layout.placed.map(({ node, box }) => (
              <Shape key={node.id} shape={node.shape ?? FlowNodeShape.Step} box={box} />
            ))}
          </svg>
          {layout.placed.map(({ node, box }) => (
            <div
              key={node.id}
              className={styles.nodeLabel}
              data-shape={node.shape ?? FlowNodeShape.Step}
              style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
              title={node.label}
            >
              <span>{node.label}</span>
            </div>
          ))}
          {lines.map((line) =>
            line.edge.label === undefined || line.edge.label === '' ? null : (
              <span
                key={`${line.edge.from}-${line.edge.to}`}
                className={styles.edgeLabel}
                style={{ left: line.labelAt.x, top: line.labelAt.y }}
              >
                {line.edge.label}
              </span>
            ),
          )}
        </div>
      </div>
      <div className="sr">
        <p>{nodesCaption}</p>
        <ol>
          {layout.placed.map(({ node }) => (
            <li key={node.id}>
              {shapeName(node.shape ?? FlowNodeShape.Step)}：{node.label}
            </li>
          ))}
        </ol>
        <p>{edgesCaption}</p>
        <ul>
          {edges.map((edge) => (
            <li key={`${edge.from}-${edge.to}`}>
              {describeEdge(labelOf.get(edge.from) ?? edge.from, labelOf.get(edge.to) ?? edge.to, edge.label)}
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}
