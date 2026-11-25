export type LayerEdge = { source: string; target: string };

/**
 * Orders the nodes within each layer by where their neighbours are (barycenter sweeps: down by upstream positions,
 * up by downstream ones, down again; stable, so the same graph always gets the same order). `pinned` nodes keep a
 * fixed rank outside the layers (the canvas's start and end pills). Shared by the plan canvas (26 §3.2) and the
 * assistant's flowcharts (35 §5.3).
 */
export function orderLayers<T extends { id: string }>(
  layers: T[][],
  edges: readonly LayerEdge[],
  pinned: ReadonlyMap<string, number> = new Map(),
): void {
  const rank = new Map(pinned);
  const rankLayer = (list: readonly T[]) => {
    list.forEach((node, i) => {
      rank.set(node.id, i - (list.length - 1) / 2);
    });
  };
  const sortBy = (list: T[], neighbours: (id: string) => string[]) => {
    const weight = (id: string) => {
      const known = neighbours(id).flatMap((n) => rank.get(n) ?? []);
      return known.length === 0 ? (rank.get(id) ?? 0) : known.reduce((a, b) => a + b, 0) / known.length;
    };
    const sorted = list.map((node) => ({ node, weight: weight(node.id) })).sort((a, b) => a.weight - b.weight);
    list.splice(0, list.length, ...sorted.map((s) => s.node));
    rankLayer(list);
  };
  const upstream = (id: string) => edges.filter((e) => e.target === id).map((e) => e.source);
  const downstream = (id: string) => edges.filter((e) => e.source === id).map((e) => e.target);
  for (const list of layers) rankLayer(list);
  for (const list of layers) sortBy(list, upstream);
  for (const list of layers.toReversed()) sortBy(list, downstream);
  for (const list of layers) sortBy(list, upstream);
}

/** 深度优先遍历按输入顺序选出回边。布局时忽略回边，渲染时将其接回。 */
export function selectBackEdges<E extends { from: string; to: string }>(
  nodes: readonly { id: string }[],
  edges: readonly E[],
): Set<E> {
  const back = new Set<E>();
  const state = new Map<string, 'open' | 'done'>();
  const outgoing = new Map<string, E[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.from);
    if (list === undefined) outgoing.set(edge.from, [edge]);
    else list.push(edge);
  }
  function visit(id: string): void {
    state.set(id, 'open');
    for (const edge of outgoing.get(id) ?? []) {
      const seen = state.get(edge.to);
      if (seen === 'open') back.add(edge);
      else if (seen === undefined) visit(edge.to);
    }
    state.set(id, 'done');
  }
  for (const node of nodes) if (!state.has(node.id)) visit(node.id);
  return back;
}
