import { orderLayers } from '../components/charts/layered-layout.ts';

/** Canvas sizes (26 §3.2, §4): fixed, so the layout needs no measuring. */
export const NODE_WIDTH = 208;
export const NODE_HEIGHT = 88;
export const END_WIDTH = 72;
export const END_HEIGHT = 32;
const COLUMN_GAP = 56;
/** Between a pill and its neighbour column: room for the + on that edge. */
const END_GAP = 52;
const ROW_GAP = 24;

/** The start and end pills: drawn on the canvas only, never part of a plan (a step key cannot contain `:`). */
export const START = ':start';
export const END = ':end';

export type LayoutStep = { id: string; dependsOn: readonly string[] };
export type Box = { x: number; y: number; width: number; height: number };
export type GraphLayout<T extends LayoutStep> = {
  /** Steps in reading order (columns left to right, top to bottom within a column) with their boxes. */
  placed: ReadonlyArray<{ step: T; box: Box }>;
  start: Box;
  end: Box;
  /** Dependencies, plus start → each first step and each last step → end. */
  edges: ReadonlyArray<{ source: string; target: string }>;
};

/**
 * Layered left-to-right layout (26 §3.2): a step's column is one past its furthest dependency; within a column steps
 * are sorted by where their neighbours are (barycenter, stable), and every column is centred on y = 0. The same graph
 * always gets the same layout. Dependencies on unknown steps are ignored; plans are acyclic.
 */
export function layoutGraph<T extends LayoutStep>(steps: readonly T[]): GraphLayout<T> {
  const ids = new Set(steps.map((s) => s.id));
  const deps = new Map(steps.map((s) => [s.id, s.dependsOn.filter((d) => ids.has(d))]));
  const column = new Map<string, number>();
  const columnOf = (id: string): number => {
    const known = column.get(id);
    if (known !== undefined) return known;
    const own = Math.max(0, ...(deps.get(id) ?? []).map(columnOf)) + 1;
    column.set(id, own);
    return own;
  };
  const columns: T[][] = [];
  for (const step of steps) {
    const index = columnOf(step.id) - 1;
    columns[index] = [...(columns[index] ?? []), step];
  }

  const isLast = (id: string) => !steps.some((s) => deps.get(s.id)?.includes(id));
  const edges = [
    ...steps.flatMap((s) => {
      const own = deps.get(s.id) ?? [];
      return own.length === 0 ? [{ source: START, target: s.id }] : own.map((d) => ({ source: d, target: s.id }));
    }),
    ...steps.filter((s) => isLast(s.id)).map((s) => ({ source: s.id, target: END })),
  ];
  if (steps.length === 0) edges.push({ source: START, target: END });

  // The pills count as one-step columns at both ends.
  orderLayers(
    columns,
    edges,
    new Map([
      [START, 0],
      [END, 0],
    ]),
  );

  const pillY = -END_HEIGHT / 2;
  const start = { x: 0, y: pillY, width: END_WIDTH, height: END_HEIGHT };
  const placed: Array<{ step: T; box: Box }> = [];
  let x = END_WIDTH + END_GAP;
  columns.forEach((list, index) => {
    let y = -(list.length * NODE_HEIGHT + (list.length - 1) * ROW_GAP) / 2;
    for (const step of list) {
      placed.push({ step, box: { x, y, width: NODE_WIDTH, height: NODE_HEIGHT } });
      y += NODE_HEIGHT + ROW_GAP;
    }
    x += NODE_WIDTH + (index === columns.length - 1 ? END_GAP : COLUMN_GAP);
  });
  return { placed, start, end: { x, y: pillY, width: END_WIDTH, height: END_HEIGHT }, edges };
}
