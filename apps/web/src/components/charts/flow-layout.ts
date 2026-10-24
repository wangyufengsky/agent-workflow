import { FlowNodeShape } from '@aw/shared';
import { orderLayers } from './layered-layout.ts';

/** Fixed node sizes, so the layout needs no measuring (35 §5.3); labels wrap to two lines inside. */
export const FLOW_NODE_SIZE: Record<FlowNodeShape, { width: number; height: number }> = {
  [FlowNodeShape.Step]: { width: 148, height: 40 },
  [FlowNodeShape.Decision]: { width: 128, height: 56 },
  [FlowNodeShape.Terminal]: { width: 120, height: 32 },
};
const LAYER_GAP = 36;
const NODE_GAP = 20;
/** Room right of the nodes for each edge that loops back. */
export const FLOW_LOOP_LANE = 14;
const LOOP_MARGIN = 18;

export type FlowLayoutNode = { id: string; shape?: FlowNodeShape | undefined };
export type FlowLayoutEdge = { from: string; to: string };
export type FlowBox = { x: number; y: number; width: number; height: number };
export type PlacedFlowEdge<E> = { edge: E; back: boolean; lane: number };
export type FlowLayout<N, E> = {
  /** Nodes in reading order (top to bottom, left to right) with their boxes. */
  placed: ReadonlyArray<{ node: N; box: FlowBox }>;
  /** Every edge; one that loops back to an earlier node runs in its own lane right of the nodes. */
  edges: ReadonlyArray<PlacedFlowEdge<E>>;
  width: number;
  height: number;
  /** Where the loop lanes start. */
  laneX: number;
};

/**
 * Edges that loop back (35 §3.2): a depth-first walk in the nodes' given order; an edge to a node still on the walk's
 * path closes a loop and is left out of the layering.
 */
function backEdges<E extends FlowLayoutEdge>(nodes: readonly FlowLayoutNode[], edges: readonly E[]): Set<E> {
  const back = new Set<E>();
  const state = new Map<string, 'open' | 'done'>();
  const visit = (id: string) => {
    state.set(id, 'open');
    for (const edge of edges.filter((e) => e.from === id)) {
      const seen = state.get(edge.to);
      if (seen === 'open') back.add(edge);
      else if (seen === undefined) visit(edge.to);
    }
    state.set(id, 'done');
  };
  for (const node of nodes) if (!state.has(node.id)) visit(node.id);
  return back;
}

/**
 * Top-to-bottom layered layout of a flowchart (35 §5.3): a node's layer is one past its furthest predecessor along
 * edges that do not loop back; layers are ordered like the plan canvas's columns and centred on one axis.
 */
export function layoutFlow<N extends FlowLayoutNode, E extends FlowLayoutEdge>(
  nodes: readonly N[],
  edges: readonly E[],
): FlowLayout<N, E> {
  const back = backEdges(nodes, edges);
  const forward = edges.filter((e) => !back.has(e));
  const layerOf = new Map<string, number>();
  const layer = (id: string): number => {
    const known = layerOf.get(id);
    if (known !== undefined) return known;
    const own = Math.max(-1, ...forward.filter((e) => e.to === id).map((e) => layer(e.from))) + 1;
    layerOf.set(id, own);
    return own;
  };
  const layers: N[][] = [];
  for (const node of nodes) {
    const index = layer(node.id);
    layers[index] = [...(layers[index] ?? []), node];
  }
  // Layers are contiguous: a node's predecessor sits one layer up.
  orderLayers(
    layers,
    forward.map((e) => ({ source: e.from, target: e.to })),
  );

  const size = (node: N) => FLOW_NODE_SIZE[node.shape ?? FlowNodeShape.Step];
  const rowWidth = (list: readonly N[]) =>
    list.reduce((sum, n) => sum + size(n).width, 0) + Math.max(0, list.length - 1) * NODE_GAP;
  const nodesWidth = Math.max(...layers.map(rowWidth));
  const placed: Array<{ node: N; box: FlowBox }> = [];
  let y = 0;
  for (const list of layers) {
    const rowHeight = Math.max(...list.map((n) => size(n).height));
    let x = (nodesWidth - rowWidth(list)) / 2;
    for (const node of list) {
      const { width, height } = size(node);
      placed.push({ node, box: { x, y: y + (rowHeight - height) / 2, width, height } });
      x += width + NODE_GAP;
    }
    y += rowHeight + LAYER_GAP;
  }
  let lane = 0;
  const placedEdges = edges.map((edge) => ({ edge, back: back.has(edge), lane: back.has(edge) ? lane++ : -1 }));
  const laneX = nodesWidth + LOOP_MARGIN;
  return {
    placed,
    edges: placedEdges,
    width: lane === 0 ? nodesWidth : laneX + lane * FLOW_LOOP_LANE,
    height: y - LAYER_GAP,
    laneX,
  };
}
