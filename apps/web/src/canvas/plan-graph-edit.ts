import { type Acceptance, NODE_KEY_PATTERN, type PlanGraph, type PlanNodeSpec } from '@aw/shared';

/** Edits of the plan editor (14 §5) as pure functions of the graph; validation is `validatePlanGraph`'s job. */

const mapNodes = (graph: PlanGraph, f: (n: PlanNodeSpec) => PlanNodeSpec): PlanGraph => ({ nodes: graph.nodes.map(f) });

/** The first `step_<n>` key the plan does not use yet. */
export function freeKey(graph: PlanGraph): string {
  const taken = new Set(graph.nodes.map((n) => n.key));
  let n = graph.nodes.length + 1;
  while (taken.has(`step_${n}`)) n += 1;
  return `step_${n}`;
}

export function addNode(graph: PlanGraph, node: Omit<PlanNodeSpec, 'key'>): { graph: PlanGraph; key: string } {
  const key = freeKey(graph);
  return { graph: { nodes: [...graph.nodes, { ...node, key }] }, key };
}

/** Removes the step and every dependency on it. */
export function removeNode(graph: PlanGraph, key: string): PlanGraph {
  return {
    nodes: graph.nodes
      .filter((n) => n.key !== key)
      .map((n) => ({ ...n, dependsOn: n.dependsOn.filter((d) => d !== key) })),
  };
}

/** Changed fields of a step; `acceptance: undefined` returns the step to the workflow's default checks. */
export type NodePatch = Partial<Omit<PlanNodeSpec, 'key' | 'acceptance'>> & { acceptance?: Acceptance | undefined };

export function updateNode(graph: PlanGraph, key: string, patch: NodePatch): PlanGraph {
  return mapNodes(graph, (n) => {
    if (n.key !== key) return n;
    const { acceptance: next, ...fields } = patch;
    const { acceptance: current, ...rest } = n;
    const acceptance = 'acceptance' in patch ? next : current;
    return { ...rest, ...fields, ...(acceptance === undefined ? {} : { acceptance }) };
  });
}

/** Why a new key cannot be used, or null; a valid rename also renames the dependencies on the step. */
export function renameProblem(graph: PlanGraph, from: string, to: string): 'pattern' | 'taken' | null {
  if (!NODE_KEY_PATTERN.test(to)) return 'pattern';
  if (to !== from && graph.nodes.some((n) => n.key === to)) return 'taken';
  return null;
}

export function renameNode(graph: PlanGraph, from: string, to: string): PlanGraph {
  return mapNodes(graph, (n) => ({
    ...n,
    key: n.key === from ? to : n.key,
    dependsOn: n.dependsOn.map((d) => (d === from ? to : d)),
  }));
}

/** `target` depends on `source` (an edge source → target on the canvas). */
export function connect(graph: PlanGraph, source: string, target: string): PlanGraph {
  return mapNodes(graph, (n) =>
    n.key === target && !n.dependsOn.includes(source) ? { ...n, dependsOn: [...n.dependsOn, source] } : n,
  );
}

export function disconnect(graph: PlanGraph, source: string, target: string): PlanGraph {
  return mapNodes(graph, (n) => (n.key === target ? { ...n, dependsOn: n.dependsOn.filter((d) => d !== source) } : n));
}
