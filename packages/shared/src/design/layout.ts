import { orderLayers, selectBackEdges } from '../graph/layered-layout.ts';

const NODE_WIDTH = 174;
const NODE_HEIGHT = 50;
const COLUMN_GAP = 80;
const ROW_GAP = 28;
const PADDING = 36;
const RETURN_LANE = 16;

type DesignLayoutNode = { id: string };
type DesignLayoutEdge = { id: string; from: string; to: string };
type DesignBox = { x: number; y: number; width: number; height: number };

export type DesignDiagramLayout = {
  width: number;
  height: number;
  placed: { id: string; box: DesignBox }[];
  routes: { id: string; path: string; back: boolean }[];
};

/** 设计工作台和离线阅读器使用相同的分层、回边选取与路径。 */
export function layoutDesignDiagram(
  nodes: readonly DesignLayoutNode[],
  edges: readonly DesignLayoutEdge[],
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
  const rows = Math.max(1, ...layers.map((layer) => layer.length));
  const returnSpace = back.size * RETURN_LANE;
  const placed = layers.flatMap((layer, column) =>
    layer.map(({ id }, row) => ({
      id,
      box: {
        x: PADDING + column * (NODE_WIDTH + COLUMN_GAP),
        y: PADDING + returnSpace + (row + (rows - layer.length) / 2) * (NODE_HEIGHT + ROW_GAP),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      },
    })),
  );
  const boxes = new Map(placed.map(({ id, box }) => [id, box]));
  let lane = 0;
  const routes = valid.flatMap((edge) => {
    const source = boxes.get(edge.from);
    const target = boxes.get(edge.to);
    if (source === undefined || target === undefined) return [];
    const backEdge = back.has(edge);
    const path = backEdge ? returnPath(source, target, PADDING + lane++ * RETURN_LANE) : edgePath(source, target);
    return [{ id: edge.id, path, back: backEdge }];
  });
  return {
    width: PADDING * 2 + NODE_WIDTH + Math.max(0, layers.length - 1) * (NODE_WIDTH + COLUMN_GAP),
    height: PADDING * 2 + returnSpace + rows * NODE_HEIGHT + (rows - 1) * ROW_GAP,
    placed,
    routes,
  };
}

function edgePath(source: DesignBox, target: DesignBox): string {
  const sx = source.x + source.width;
  const sy = source.y + source.height / 2;
  const tx = target.x;
  const ty = target.y + target.height / 2;
  const middle = (sx + tx) / 2;
  return `M ${sx} ${sy} C ${middle} ${sy}, ${middle} ${ty}, ${tx} ${ty}`;
}

function returnPath(source: DesignBox, target: DesignBox, lane: number): string {
  const sx = source.x + source.width;
  const sy = source.y + source.height / 2;
  const tx = target.x;
  const ty = target.y + target.height / 2;
  const out = sx + ROW_GAP / 2;
  const incoming = tx - ROW_GAP / 2;
  return `M ${sx} ${sy} H ${out} V ${lane} H ${incoming} V ${ty} H ${tx}`;
}
