/**
 * Whole percentages that add up to exactly 100 (largest remainder): the pie's legend never reads 99 % or 101 %
 * (35 §5.2). A zero total has no shares.
 */
export function sharePercents(values: readonly number[]): number[] {
  const total = values.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((v) => (v / total) * 100);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((sum, v) => sum + v, 0);
  const byRemainder = exact.map((v, i) => ({ i, rest: v - Math.floor(v) })).sort((a, b) => b.rest - a.rest);
  for (const { i } of byRemainder) {
    if (left === 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    left -= 1;
  }
  return floors;
}

/** Display width of a label: CJK and other wide characters count 2, the rest 1. */
export function displayWidth(text: string): number {
  return [...text].reduce((width, ch) => width + ((ch.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1), 0);
}

/** Categories at most for horizontal bars, and the label width beyond which they read better than columns. */
const HORIZONTAL_MAX_CATEGORIES = 16;
const COLUMN_LABEL_WIDTH = 6;

/** Bars lie horizontally when the labels are long and few enough to list (35 §5.2, D141). */
export function isHorizontalBar(categories: readonly string[]): boolean {
  return (
    categories.length <= HORIZONTAL_MAX_CATEGORIES && Math.max(...categories.map(displayWidth)) > COLUMN_LABEL_WIDTH
  );
}

/** Runs of consecutive values without gaps: each becomes one polyline. */
export function runs(values: readonly (number | null)[]): Array<Array<{ i: number; value: number }>> {
  const out: Array<Array<{ i: number; value: number }>> = [];
  let current: Array<{ i: number; value: number }> = [];
  values.forEach((value, i) => {
    if (value === null) {
      if (current.length > 0) out.push(current);
      current = [];
    } else current.push({ i, value });
  });
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * The points a line chart marks: all of them when `all`, otherwise only those alone between gaps, which a polyline of
 * one point cannot draw (35 §5.2).
 */
export function markedPoints(values: readonly (number | null)[], all: boolean): Array<{ i: number; value: number }> {
  return runs(values).flatMap((run) => (all || run.length === 1 ? run : []));
}
