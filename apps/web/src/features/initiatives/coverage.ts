import type { InitiativeCoverage } from '@aw/shared';

export type CoverageLine = {
  point: string;
  /** `skipped`: the AI left the point out on purpose; `removed`: every work package it named was deleted since. */
  state: 'covered' | 'removed' | 'skipped';
  titles: string[];
};

/**
 * The AI's coverage table against the work packages as they are now (34 §5.2): the user may have deleted some since
 * the breakdown, and the table keeps the keys the AI gave.
 */
export function coverageLines(
  coverage: readonly InitiativeCoverage[],
  items: ReadonlyArray<{ key: string; title: string }>,
): { covered: number; lines: CoverageLine[] } {
  const titleOf = new Map(items.map((item) => [item.key, item.title]));
  const lines = coverage.map((line): CoverageLine => {
    const titles = line.items.flatMap((key) => titleOf.get(key) ?? []);
    const state = line.items.length === 0 ? 'skipped' : titles.length === 0 ? 'removed' : 'covered';
    return { point: line.point, state, titles };
  });
  return { covered: lines.filter((line) => line.state === 'covered').length, lines };
}
