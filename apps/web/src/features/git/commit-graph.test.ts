import { describe, expect, it } from 'vitest';
import { layoutGraph } from './commit-graph.ts';

const c = (sha: string, ...parents: string[]) => ({ sha, parents });

describe('提交图谱的泳道（27 §6.2）', () => {
  it('一条直线：每个提交在第 0 道，上下相连，最后一个没有父提交时线在它这里结束', () => {
    expect(layoutGraph([c('c', 'b'), c('b', 'a'), c('a')]).map((r) => [r.lane, r.up, r.down])).toEqual([
      [0, false, true],
      [0, true, true],
      [0, true, false],
    ]);
  });

  it('合并提交的第二个父提交另开一道并在分叉点汇回；其间第 0 道的提交看到它贯穿', () => {
    // m merges f (feature) into b (main); f forked from a.
    const rows = layoutGraph([c('m', 'b', 'f'), c('b', 'a'), c('f', 'a'), c('a')]);
    expect(rows.map((r) => ({ lane: r.lane, pass: r.pass, inFrom: r.inFrom, out: r.out, after: r.after }))).toEqual([
      { lane: 0, pass: [], inFrom: [], out: [1], after: [0, 1] },
      { lane: 0, pass: [1], inFrom: [], out: [], after: [0, 1] },
      { lane: 1, pass: [0], inFrom: [], out: [], after: [0, 1] },
      { lane: 0, pass: [], inFrom: [1], out: [], after: [] },
    ]);
  });

  it('列表中没有子提交的分支头另占一道', () => {
    const rows = layoutGraph([c('x', 'a'), c('y', 'a'), c('a')]);
    expect(rows.map((r) => [r.lane, r.up])).toEqual([
      [0, false],
      [1, false],
      [0, true],
    ]);
    expect(rows[2]?.inFrom).toEqual([1]);
  });
});
