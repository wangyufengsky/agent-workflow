import { orderLayers, selectBackEdges } from '../graph/layered-layout.ts';

const NODE_WIDTH = 174;
const NODE_HEIGHT = 50;
const COLUMN_GAP = 80;
const ROW_GAP = 28;
const PADDING = 36;
const RETURN_LANE = 16;

type DesignLayoutNode = { id: string; width?: number; height?: number };
type DesignLayoutEdge = { id: string; from: string; to: string };
type DesignBox = { x: number; y: number; width: number; height: number };

export type DesignDiagramLayout = {
  width: number;
  height: number;
  placed: { id: string; box: DesignBox }[];
  routes: { id: string; path: string; back: boolean; labelX: number; labelY: number; labelWidth: number }[];
};

function transpose(box: DesignBox): DesignBox {
  return { x: box.y, y: box.x, width: box.height, height: box.width };
}

/** 普通图保持横向，交易图按拓扑选阅读方向；两种方向共用分层、节点尺寸和回边通道。 */
export function layoutDesignDiagram(
  nodes: readonly DesignLayoutNode[],
  edges: readonly DesignLayoutEdge[],
  orientation: 'horizontal' | 'adaptive' = 'horizontal',
): DesignDiagramLayout {
  const ids = new Set(nodes.map(({ id }) => id));
  const valid = edges.filter(({ from, to }) => ids.has(from) && ids.has(to));
  const back = selectBackEdges(nodes, valid);
  const forward = valid.filter((edge) => !back.has(edge));
  const predecessors = new Map<string, string[]>();
  for (const { from, to } of forward) {
    const known = predecessors.get(to);
    if (known === undefined) predecessors.set(to, [from]);
    else known.push(from);
  }
  const columns = new Map<string, number>();
  function columnOf(id: string): number {
    const known = columns.get(id);
    if (known !== undefined) return known;
    const column = Math.max(-1, ...(predecessors.get(id) ?? []).map(columnOf)) + 1;
    columns.set(id, column);
    return column;
  }
  const layers: DesignLayoutNode[][] = [];
  for (const node of nodes) {
    const column = columnOf(node.id);
    const layer = layers[column] ?? [];
    layer.push(node);
    layers[column] = layer;
  }
  orderLayers(
    layers,
    forward.map(({ from, to }) => ({ source: from, target: to })),
  );
  const vertical =
    orientation === 'adaptive' && layers.length > 3 && layers.length > Math.max(...layers.map((layer) => layer.length));
  const sizes = layers.map((layer) => {
    const items = layer.map(({ id, width = NODE_WIDTH, height = NODE_HEIGHT }) => ({
      id,
      width: vertical ? height : width,
      height: vertical ? width : height,
    }));
    const span = items.reduce((sum, node) => sum + node.height, (items.length - 1) * ROW_GAP);
    const thickness = Math.max(...items.map(({ width }) => width));
    return { items, span, thickness };
  });
  const lane = orientation === 'horizontal' ? RETURN_LANE : vertical ? 2 * PADDING : ROW_GAP;
  const crossSpan = Math.max(NODE_HEIGHT, ...sizes.map(({ span }) => span));
  const boxes = new Map<string, { box: DesignBox; before: number; after: number }>();
  let along = PADDING;
  for (const { items, span, thickness } of sizes) {
    let across = PADDING + back.size * lane + (crossSpan - span) / 2;
    for (const { id, width, height } of items) {
      boxes.set(id, {
        box: { x: along + (thickness - width) / 2, y: across, width, height },
        before: along - ROW_GAP / 2,
        after: along + thickness + ROW_GAP / 2,
      });
      across += height + ROW_GAP;
    }
    along += thickness + COLUMN_GAP;
  }
  const width = PADDING + (sizes.length ? along - COLUMN_GAP : PADDING + NODE_WIDTH);
  const bottom = PADDING + back.size * lane + crossSpan;
  let upperLane = 0;
  let lowerLane = 0;
  const routedPairs = new Set<string>();
  const routes: DesignDiagramLayout['routes'] = [];
  for (const edge of valid) {
    const source = boxes.get(edge.from);
    const target = boxes.get(edge.to);
    if (source === undefined || target === undefined) continue;
    const backEdge = back.has(edge);
    const pair = JSON.stringify([edge.from, edge.to]);
    const parallel = routedPairs.has(pair);
    routedPairs.add(pair);
    const direct = routeBetween(source.box, target.box, vertical, undefined);
    let outside: number | undefined;
    if (backEdge) outside = PADDING + upperLane++ * lane;
    else if (
      orientation === 'adaptive' &&
      (parallel ||
        columnOf(edge.to) > columnOf(edge.from) + 1 ||
        routes.some(
          (other) =>
            Math.abs(other.labelY - direct.labelY) < 20 &&
            Math.abs(other.labelX - direct.labelX) < (other.labelWidth + direct.labelWidth) / 2,
        ))
    )
      outside = bottom + ++lowerLane * lane;
    const route =
      outside === undefined
        ? direct
        : routeBetween(source.box, target.box, vertical, {
            lane: outside,
            out: source.after,
            enter: target.before,
          });
    routes.push({ id: edge.id, back: backEdge, ...route });
  }
  const height = bottom + lowerLane * lane + PADDING;
  return {
    width: vertical ? height : width,
    height: vertical ? width : height,
    placed: Array.from(boxes, ([id, { box }]) => ({ id, box: vertical ? transpose(box) : box })),
    routes,
  };
}

function routeBetween(
  source: DesignBox,
  target: DesignBox,
  vertical: boolean,
  detour: { lane: number; out: number; enter: number } | undefined,
) {
  const point = (x: number, y: number) => (vertical ? `${y} ${x}` : `${x} ${y}`);
  const sx = source.x + source.width;
  const sy = source.y + source.height / 2;
  const tx = target.x;
  const ty = target.y + target.height / 2;
  const middle = (sx + tx) / 2;
  const label = detour?.lane ?? (sy + ty) / 2;
  const start = `M ${point(sx, sy)}`;
  const end = point(tx, ty);
  const path =
    detour === undefined
      ? `${start} C ${point(middle, sy)}, ${point(middle, ty)}, ${end}`
      : `${start} L ${point(detour.out, sy)} L ${point(detour.out, detour.lane)} L ${point(detour.enter, detour.lane)} L ${point(detour.enter, ty)} L ${end}`;
  const labelWidth = vertical
    ? detour === undefined
      ? 116
      : 2 * PADDING - 12
    : Math.max(48, Math.min(160, Math.abs(tx - sx) - 12));
  return { path, labelWidth, labelX: vertical ? label : middle, labelY: vertical ? middle : label };
}
