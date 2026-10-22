import type { PlanGraph } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { END, START } from './layout.ts';
import {
  addAfter,
  addAtEnd,
  addParallel,
  connect,
  disconnect,
  insertBetween,
  removeAndReconnect,
  renameNode,
  renameProblem,
} from './plan-graph-edit.ts';

const node = (key: string, ...dependsOn: string[]) => ({
  key,
  title: key,
  roleKey: 'developer',
  instructions: key,
  dependsOn,
});
/** a → b, a → c, b → d, c → d */
const diamond: PlanGraph = { nodes: [node('a'), node('b', 'a'), node('c', 'a'), node('d', 'b', 'c')] };
const step = { title: '新步骤', roleKey: 'developer', instructions: '' };
const deps = (g: PlanGraph) => Object.fromEntries(g.nodes.map((n) => [n.key, n.dependsOn]));

describe('计划画布的编辑', () => {
  it('在连线上插入：新步骤接在两步之间；从开始插入成为新的首步，插到结束前成为新的末步', () => {
    expect(deps(insertBetween(diamond, 'a', 'b', step).graph)).toEqual({
      a: [],
      b: ['step_5'],
      c: ['a'],
      d: ['b', 'c'],
      step_5: ['a'],
    });
    expect(deps(insertBetween(diamond, START, 'a', step).graph)).toMatchObject({ a: ['step_5'], step_5: [] });
    expect(deps(insertBetween(diamond, 'd', END, step).graph)).toMatchObject({ d: ['b', 'c'], step_5: ['d'] });
  });

  it('添加下一步插在步骤与它所有下游之间；并行步骤与它同依赖、同下游；接在最后依赖所有末步', () => {
    expect(deps(addAfter(diamond, 'a', step).graph)).toEqual({
      a: [],
      b: ['step_5'],
      c: ['step_5'],
      d: ['b', 'c'],
      step_5: ['a'],
    });
    expect(deps(addParallel(diamond, 'b', step).graph)).toMatchObject({ d: ['b', 'c', 'step_5'], step_5: ['a'] });
    const twoEnds: PlanGraph = { nodes: [node('a'), node('b', 'a'), node('c', 'a')] };
    expect(addAtEnd(twoEnds, step)).toMatchObject({
      key: 'step_4',
      graph: { nodes: [{}, {}, {}, { dependsOn: ['b', 'c'] }] },
    });
  });

  it('删除步骤后前后自动相连，已经间接相连的不再加依赖', () => {
    expect(deps(removeAndReconnect(diamond, 'a'))).toEqual({ b: [], c: [], d: ['b', 'c'] });
    expect(deps(removeAndReconnect(diamond, 'b'))).toEqual({ a: [], c: ['a'], d: ['c'] });
    const chain: PlanGraph = { nodes: [node('a'), node('b', 'a'), node('c', 'b')] };
    expect(deps(removeAndReconnect(chain, 'b'))).toEqual({ a: [], c: ['a'] });
  });

  it('连线与断开改变依赖且不重复；改名同时改写依赖并检查格式与重复', () => {
    expect(deps(connect(connect(diamond, 'b', 'c'), 'b', 'c'))).toMatchObject({ c: ['a', 'b'] });
    expect(deps(disconnect(diamond, 'a', 'b'))).toMatchObject({ b: [] });
    expect(deps(renameNode(diamond, 'a', 'setup'))).toMatchObject({ setup: [], b: ['setup'], c: ['setup'] });
    expect([
      renameProblem(diamond, 'a', 'B!'),
      renameProblem(diamond, 'a', 'b'),
      renameProblem(diamond, 'a', 'a2'),
    ]).toEqual(['pattern', 'taken', null]);
  });
});
