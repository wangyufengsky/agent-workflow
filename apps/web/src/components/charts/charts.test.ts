import { describe, expect, it } from 'vitest';
import { isHorizontalBar, markedPoints, ringArcs, sharePercents } from './chart-math.ts';
import { layoutFlow } from './flow-layout.ts';
import { niceRange, niceTicks } from './ticks.ts';

describe('刻度', () => {
  it('从 0 到不小于最大值的整齐刻度', () => {
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(0)).toEqual([0]);
  });

  it('含负数时覆盖最小值并保留 0', () => {
    expect(niceRange(-3, 7)).toEqual([-5, 0, 5, 10]);
    expect(niceRange(-8, -2)).toEqual([-8, -6, -4, -2, 0]);
  });
});

describe('饼图百分比', () => {
  it('按最大余数取整，合计恰为 100', () => {
    expect(sharePercents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(sharePercents([7, 2, 1])).toEqual([70, 20, 10]);
    expect(sharePercents([2, 1, 1, 1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe('环形饼图的弧', () => {
  it('切片之间留缝，但很小的正值仍有弧长；零值没有弧；只有一片时是整圈', () => {
    const arcs = ringArcs([99, 1, 0]);
    expect(arcs.map((a) => a.offset)).toEqual([-0, -99, -100]);
    expect(arcs[0]?.length).toBeCloseTo(97.8);
    expect(arcs[1]?.length).toBeCloseTo(0.5);
    expect(arcs[2]?.length).toBe(0);
    expect(ringArcs([0, 5]).map((a) => a.length)).toEqual([0, 100]);
  });
});

describe('柱状图方向', () => {
  it('类别名长且不多时横向，否则纵向', () => {
    expect(isHorizontalBar(['已完成', '待合并'])).toBe(false);
    expect(isHorizontalBar(['packages/server', 'apps/web'])).toBe(true);
    expect(isHorizontalBar(Array.from({ length: 17 }, (_, i) => `很长的模块名${i}`))).toBe(false);
  });
});

describe('折线图的点', () => {
  it('点不多时每个值都标出；点多时只标两侧都是缺值的孤点，否则它画不出来', () => {
    const values = [3, null, 5, 6, null, 2];
    expect(markedPoints(values, true).map((p) => p.i)).toEqual([0, 2, 3, 5]);
    expect(markedPoints(values, false).map((p) => p.i)).toEqual([0, 5]);
  });
});

describe('流程图布局', () => {
  const node = (id: string) => ({ id });
  const edge = (from: string, to: string) => ({ from, to });
  const rows = (layout: ReturnType<typeof layoutFlow>) => {
    const byY = new Map<number, string[]>();
    for (const { node, box } of layout.placed) {
      const center = box.y + box.height / 2;
      byY.set(center, [...(byY.get(center) ?? []), node.id]);
    }
    return [...byY.entries()].sort((a, b) => a[0] - b[0]).map(([, ids]) => ids);
  };

  it('自上而下分层；指回前面节点的边是回边，不影响分层，各占一条通道', () => {
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'b'), edge('c', 'd'), edge('d', 'a')];
    const layout = layoutFlow(['a', 'b', 'c', 'd'].map(node), edges);
    expect(rows(layout)).toEqual([['a'], ['b'], ['c'], ['d']]);
    expect(layout.edges.map((e) => [e.edge.from, e.edge.to, e.back, e.lane])).toEqual([
      ['a', 'b', false, -1],
      ['b', 'c', false, -1],
      ['c', 'b', true, 0],
      ['c', 'd', false, -1],
      ['d', 'a', true, 1],
    ]);
    expect(layout.width).toBeGreaterThan(layout.laneX);
  });

  it('分支并排、孤立节点在第一层；相同输入得到相同布局', () => {
    const nodes = ['start', 'x', 'y', 'end', 'note'].map(node);
    const edges = [edge('start', 'x'), edge('start', 'y'), edge('x', 'end'), edge('y', 'end')];
    const layout = layoutFlow(nodes, edges);
    expect(rows(layout)).toEqual([['start', 'note'], ['x', 'y'], ['end']]);
    expect(layoutFlow(nodes, edges)).toEqual(layout);
  });
});
