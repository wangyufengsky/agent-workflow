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
