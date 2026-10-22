import { describe, expect, it } from 'vitest';
import { END, layoutGraph, NODE_HEIGHT, START } from './layout.ts';

const step = (id: string, ...dependsOn: string[]) => ({ id, dependsOn });
type Layout = ReturnType<typeof layoutGraph>;
const columnsOf = (layout: Layout) => {
  const byX = new Map<number, string[]>([[layout.start.x, [START]]]);
  for (const { step, box } of layout.placed) byX.set(box.x, [...(byX.get(box.x) ?? []), step.id]);
  byX.set(layout.end.x, [END]);
  return [...byX.entries()].sort((a, b) => a[0] - b[0]).map(([, ids]) => ids);
};
const yOf = (layout: Layout, id: string) => layout.placed.find((p) => p.step.id === id)?.box.y;

describe('画布布局', () => {
  it('步骤在最远的依赖之后一列，开始与结束在两端，并连到首步与末步', () => {
    const layout = layoutGraph([step('a'), step('b', 'a'), step('c', 'a'), step('d', 'b', 'c'), step('e', 'a')]);
    expect(columnsOf(layout)).toEqual([[START], ['a'], ['b', 'c', 'e'], ['d'], [END]]);
    expect(layout.edges).toEqual([
      { source: START, target: 'a' },
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'b', target: 'd' },
      { source: 'c', target: 'd' },
      { source: 'a', target: 'e' },
      { source: 'd', target: END },
      { source: 'e', target: END },
    ]);
    expect(layout.placed.map((p) => p.step.id)).toEqual(['a', 'b', 'c', 'e', 'd']);
  });

  it('每列以 0 为中心竖直排列', () => {
    const layout = layoutGraph([step('a'), step('b')]);
    expect([yOf(layout, 'a'), yOf(layout, 'b')]).toEqual([-NODE_HEIGHT - 12, 12]);
  });

  it('按上下游的位置排列同一列，减少连线交叉', () => {
    // b1 follows the lower a2 and b2 the upper a1: in plan order the two edges would cross.
    const layout = layoutGraph([step('a1'), step('a2'), step('b1', 'a2'), step('b2', 'a1')]);
    expect(columnsOf(layout)[2]).toEqual(['b2', 'b1']);
  });

  it('没有步骤时开始直接连到结束', () => {
    expect(layoutGraph([]).edges).toEqual([{ source: START, target: END }]);
  });
});
