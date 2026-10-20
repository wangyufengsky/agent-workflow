import { describe, expect, it } from 'vitest';
import { lockedChanges } from './plan-edit.ts';
import type { PlanGraph, PlanNodeSpec } from './plan-graph.ts';

const node = (key: string, dependsOn: string[] = [], extra: Partial<PlanNodeSpec> = {}): PlanNodeSpec => ({
  key,
  title: key,
  roleKey: 'developer',
  instructions: `do ${key}`,
  dependsOn,
  ...extra,
});
const graph = (...nodes: PlanNodeSpec[]): PlanGraph => ({ nodes });

describe('lockedChanges', () => {
  const base = graph(node('a'), node('b'), node('c', ['a', 'b']));
  const locked = new Set(['a', 'c']);

  it('只改未开始的节点、调整顺序或依赖的书写顺序不算改动已开始的节点', () => {
    const next = graph(node('c', ['b', 'a']), node('a'), node('b', [], { title: 'B!' }), node('d', ['c']));
    expect(lockedChanges(base, next, locked)).toEqual([]);
  });

  it('列出被改动或删除的已开始节点', () => {
    const next = graph(node('a', [], { acceptance: { checks: [], manual: true } }), node('b'));
    expect(lockedChanges(base, next, locked)).toEqual(['a', 'c']);
  });
});
