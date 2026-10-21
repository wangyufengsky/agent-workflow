import { describe, expect, it } from 'vitest';
import { dependencyCandidates, transitiveDependencies } from './plan-dependencies.ts';

const graph = [
  { key: 'a', dependsOn: [] },
  { key: 'b', dependsOn: ['a'] },
  { key: 'c', dependsOn: ['b', 'ghost'] },
  { key: 'd', dependsOn: [] },
];

describe('plan dependencies', () => {
  it('传递依赖包含间接上游，跳过不存在的步骤', () => {
    expect(transitiveDependencies(graph, 'c')).toEqual(new Set(['b', 'a']));
  });

  it('可依赖的步骤不含自己和已经依赖它的下游，因此不会成环', () => {
    expect(dependencyCandidates(graph, 'b').map((n) => n.key)).toEqual(['a', 'd']);
    expect(dependencyCandidates(graph, 'a').map((n) => n.key)).toEqual(['d']);
  });

  it('图里已有环时也能结束', () => {
    const cyclic = [
      { key: 'x', dependsOn: ['y'] },
      { key: 'y', dependsOn: ['x'] },
    ];
    expect(transitiveDependencies(cyclic, 'x')).toEqual(new Set(['y', 'x']));
  });
});
