import {
  type Acceptance,
  lockedChanges,
  NODE_KEY_PATTERN,
  type PlanGraph,
  type PlanNodeSpec,
  PlanProblemCode,
  type PlanRules,
  transitiveDependencies,
  validatePlanGraph,
} from '@aw/shared';
import { START } from './layout.ts';
import type { PlanLock } from './plan-check.ts';

/** Edits of the plan editor (26 §5) as pure functions of the graph; validation is `validatePlanGraph`'s job. */

const mapNodes = (graph: PlanGraph, f: (n: PlanNodeSpec) => PlanNodeSpec): PlanGraph => ({ nodes: graph.nodes.map(f) });

/** The first `step_<n>` key the plan does not use yet. */
export function freeKey(graph: PlanGraph): string {
  const taken = new Set(graph.nodes.map((n) => n.key));
  let n = graph.nodes.length + 1;
  while (taken.has(`step_${n}`)) n += 1;
  return `step_${n}`;
}

/** What a new step starts with; the operation picks its key and dependencies. */
export type NewStep = Omit<PlanNodeSpec, 'key' | 'dependsOn'>;
export type Added = { graph: PlanGraph; key: string };

const withNode = (graph: PlanGraph, node: PlanNodeSpec, rewire: (n: PlanNodeSpec) => readonly string[]): PlanGraph => ({
  nodes: [...graph.nodes.map((n) => ({ ...n, dependsOn: [...rewire(n)] })), node],
});

/**
 * Inserts a step on the edge `source` → `target` (26 §5.1); `START` / `END` are the canvas pills: from start the new
 * step has no dependencies, into end it becomes a last step. Like every operation here the result stays acyclic.
 */
export function insertBetween(graph: PlanGraph, source: string, target: string, step: NewStep): Added {
  const key = freeKey(graph);
  const node = { ...step, key, dependsOn: source === START ? [] : [source] };
  const rewire = (n: PlanNodeSpec) => {
    if (n.key !== target) return n.dependsOn;
    return source === START ? [...n.dependsOn, key] : n.dependsOn.map((d) => (d === source ? key : d));
  };
  return { graph: withNode(graph, node, rewire), key };
}

/** A step right after `after`, between it and everything that followed it. */
export function addAfter(graph: PlanGraph, after: string, step: NewStep): Added {
  const key = freeKey(graph);
  const rewire = (n: PlanNodeSpec) => n.dependsOn.map((d) => (d === after ? key : d));
  return { graph: withNode(graph, { ...step, key, dependsOn: [after] }, rewire), key };
}

/** A step beside `beside`: the same dependencies, and whatever followed it follows the new step too. */
export function addParallel(graph: PlanGraph, beside: string, step: NewStep): Added {
  const key = freeKey(graph);
  const dependsOn = graph.nodes.find((n) => n.key === beside)?.dependsOn ?? [];
  const rewire = (n: PlanNodeSpec) => (n.dependsOn.includes(beside) ? [...n.dependsOn, key] : n.dependsOn);
  return { graph: withNode(graph, { ...step, key, dependsOn: [...dependsOn] }, rewire), key };
}

/** A step after all current last steps: the plan's new only last step. */
export function addAtEnd(graph: PlanGraph, step: NewStep): Added {
  const key = freeKey(graph);
  const last = graph.nodes.filter((n) => !graph.nodes.some((m) => m.dependsOn.includes(n.key))).map((n) => n.key);
  return { graph: withNode(graph, { ...step, key, dependsOn: last }, (n) => n.dependsOn), key };
}

const orderProblems = (graph: PlanGraph, rules: PlanRules) =>
  validatePlanGraph(graph, rules).filter((p) => p.code === PlanProblemCode.RequiredStepOrder).length;

/**
 * Whether an edit of `current` may be offered (26 §5.4): its result changes no more locked steps and breaks no more
 * required-step positions than `current` already does.
 */
export function editGuard(
  current: PlanGraph,
  rules: PlanRules,
  lock: PlanLock | undefined,
): (next: PlanGraph) => boolean {
  const lockedNow = lock === undefined ? 0 : lockedChanges(lock.base, current, lock.locked).length;
  const orderNow = orderProblems(current, rules);
  return (next) =>
    (lock === undefined || lockedChanges(lock.base, next, lock.locked).length <= lockedNow) &&
    orderProblems(next, rules) <= orderNow;
}

/**
 * The toolbar's 添加步骤 (26 §5.1): after the selected step, else after all last steps, whichever the guard allows;
 * undefined when neither is, and the button is disabled.
 */
export function addStep(
  graph: PlanGraph,
  selected: string | undefined,
  step: NewStep,
  allowed: (next: PlanGraph) => boolean,
): Added | undefined {
  const candidates = [...(selected === undefined ? [] : [addAfter(graph, selected, step)]), addAtEnd(graph, step)];
  return candidates.find((c) => allowed(c.graph));
}

/**
 * Removes a step and joins its neighbours (26 §5.2): each step that followed it depends on each step it depended on,
 * unless it already does through another path. Upstream came before the step and downstream after, so no cycle forms.
 */
export function removeAndReconnect(graph: PlanGraph, key: string): PlanGraph {
  const upstream = graph.nodes.find((n) => n.key === key)?.dependsOn ?? [];
  let nodes = graph.nodes
    .filter((n) => n.key !== key)
    .map((n) => ({ ...n, dependsOn: n.dependsOn.filter((d) => d !== key) }));
  for (const down of graph.nodes.filter((n) => n.dependsOn.includes(key))) {
    for (const up of upstream) {
      if (transitiveDependencies(nodes, down.key).has(up)) continue;
      nodes = nodes.map((n) => (n.key === down.key ? { ...n, dependsOn: [...n.dependsOn, up] } : n));
    }
  }
  return { nodes };
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
