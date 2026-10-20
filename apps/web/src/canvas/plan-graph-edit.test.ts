import type { PlanGraph } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { addNode, connect, disconnect, removeNode, renameNode, renameProblem } from './plan-graph-edit.ts';

const graph: PlanGraph = {
  nodes: [
    { key: 'a', title: 'A', roleKey: 'developer', instructions: 'a', dependsOn: [] },
    { key: 'b', title: 'B', roleKey: 'developer', instructions: 'b', dependsOn: ['a'] },
  ],
};
const deps = (g: PlanGraph) => Object.fromEntries(g.nodes.map((n) => [n.key, n.dependsOn]));

describe('计划画布的编辑', () => {
  it('新增步骤取未用的 key；连线与断开改变依赖且不重复', () => {
    const { graph: added, key } = addNode(graph, { title: 'C', roleKey: 'tester', instructions: 'c', dependsOn: [] });
    expect(key).toBe('step_3');
    const linked = connect(connect(added, 'b', key), 'b', key);
    expect(deps(linked)).toEqual({ a: [], b: ['a'], step_3: ['b'] });
    expect(deps(disconnect(linked, 'a', 'b'))).toEqual({ a: [], b: [], step_3: ['b'] });
  });

  it('删除与改名同时更新其他步骤对它的依赖；改名检查格式与重复', () => {
    expect(deps(removeNode(graph, 'a'))).toEqual({ b: [] });
    expect(deps(renameNode(graph, 'a', 'setup'))).toEqual({ setup: [], b: ['setup'] });
    expect([renameProblem(graph, 'a', 'B!'), renameProblem(graph, 'a', 'b'), renameProblem(graph, 'a', 'a2')]).toEqual([
      'pattern',
      'taken',
      null,
    ]);
  });
});
