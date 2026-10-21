import type { PlanNodeSpec } from './plan-graph.ts';

type DependencyNode = Pick<PlanNodeSpec, 'key' | 'dependsOn'>;

/** Every step `key` depends on, directly or through other steps; unknown keys are skipped and cycles end the walk. */
export function transitiveDependencies(nodes: Iterable<DependencyNode>, key: string): Set<string> {
  const byKey = new Map([...nodes].map((n) => [n.key, n]));
  const found = new Set<string>();
  const pending = [...(byKey.get(key)?.dependsOn ?? [])];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const node = byKey.get(next);
    if (node === undefined || found.has(next)) continue;
    found.add(next);
    pending.push(...node.dependsOn);
  }
  return found;
}

/** Steps `key` may depend on without closing a cycle: all others except those that already depend on it. */
export function dependencyCandidates<N extends DependencyNode>(nodes: readonly N[], key: string): N[] {
  return nodes.filter((n) => n.key !== key && !transitiveDependencies(nodes, n.key).has(key));
}
