import { NODE_INSTRUCTIONS_MAX_CHARS, PLAN_MAX_NODES } from '../constants/limits.ts';
import { RequiredStepPosition } from '../enums/workflow.ts';
import { type PlanProblem, PlanProblemCode } from '../errors/plan-problems.ts';
import { transitiveDependencies } from './plan-dependencies.ts';
import type { PlanGraph, PlanNodeSpec, RequiredStep } from './plan-graph.ts';

export type PlanRules = {
  /** Role keys the workflow allows. */
  allowedRoles: readonly string[];
  requiredSteps: readonly Pick<RequiredStep, 'key' | 'position'>[];
};

/** Validates a plan against structural rules and the workflow's constraints; an empty result means valid. */
export function validatePlanGraph(graph: PlanGraph, rules: PlanRules): PlanProblem[] {
  if (graph.nodes.length === 0) return [{ code: PlanProblemCode.Empty, message: 'Plan has no nodes' }];

  const problems: PlanProblem[] = [];
  if (graph.nodes.length > PLAN_MAX_NODES) {
    problems.push({
      code: PlanProblemCode.TooManyNodes,
      message: `Plan has ${graph.nodes.length} nodes, at most ${PLAN_MAX_NODES} allowed`,
      details: { max: PLAN_MAX_NODES },
    });
  }

  const byKey = new Map<string, PlanNodeSpec>();
  for (const node of graph.nodes) {
    if (byKey.has(node.key)) {
      problems.push({
        code: PlanProblemCode.DuplicateKey,
        nodeKey: node.key,
        message: `Duplicate node key ${node.key}`,
      });
    } else {
      byKey.set(node.key, node);
    }
  }

  for (const node of graph.nodes) problems.push(...checkNode(node, byKey, rules));

  const cycles = findCycles(byKey);
  for (const cycle of cycles) {
    problems.push({
      code: PlanProblemCode.Cycle,
      nodeKey: cycle[0],
      message: `Dependency cycle ${cycle.join(' -> ')}`,
      details: { cycle },
    });
  }

  for (const step of rules.requiredSteps) {
    if (!byKey.has(step.key)) {
      problems.push({
        code: PlanProblemCode.MissingRequiredStep,
        nodeKey: step.key,
        message: `Required step ${step.key} is missing`,
        details: { requiredStep: step.key },
      });
    }
  }
  // Ordering is undefined while the graph has cycles; those are reported above and must be fixed first.
  if (cycles.length === 0) problems.push(...checkRequiredStepOrder(byKey, rules.requiredSteps));
  return problems;
}

function checkNode(node: PlanNodeSpec, byKey: ReadonlyMap<string, PlanNodeSpec>, rules: PlanRules): PlanProblem[] {
  const problems: PlanProblem[] = [];
  if (node.instructions.length > NODE_INSTRUCTIONS_MAX_CHARS) {
    problems.push({
      code: PlanProblemCode.InstructionsTooLong,
      nodeKey: node.key,
      message: `Instructions have ${node.instructions.length} characters, at most ${NODE_INSTRUCTIONS_MAX_CHARS} allowed`,
      details: { max: NODE_INSTRUCTIONS_MAX_CHARS },
    });
  }
  if (!rules.allowedRoles.includes(node.roleKey)) {
    problems.push({
      code: PlanProblemCode.UnknownRole,
      nodeKey: node.key,
      message: `Role ${node.roleKey} is not allowed by this workflow`,
      details: { allowedRoles: [...rules.allowedRoles] },
    });
  }
  for (const dependency of node.dependsOn) {
    if (!byKey.has(dependency)) {
      problems.push({
        code: PlanProblemCode.UnknownDependency,
        nodeKey: node.key,
        message: `Node ${node.key} depends on unknown node ${dependency}`,
        details: { dependency },
      });
    }
  }
  return problems;
}

/** Every cycle closed by a back edge of a depth-first search, as `[a, b, ..., a]`; also for initiatives (34 §8.3). */
export function findCycles(byKey: ReadonlyMap<string, { key: string; dependsOn: readonly string[] }>): string[][] {
  const cycles: string[][] = [];
  const finished = new Set<string>();
  const path: string[] = [];

  const visit = (node: { key: string; dependsOn: readonly string[] }): void => {
    path.push(node.key);
    for (const key of node.dependsOn) {
      const dependency = byKey.get(key);
      if (dependency === undefined || finished.has(key)) continue;
      const index = path.indexOf(key);
      if (index === -1) visit(dependency);
      else cycles.push([...path.slice(index), key]);
    }
    path.pop();
    finished.add(node.key);
  };
  for (const node of byKey.values()) if (!finished.has(node.key)) visit(node);
  return cycles;
}

function checkRequiredStepOrder(
  byKey: ReadonlyMap<string, PlanNodeSpec>,
  requiredSteps: PlanRules['requiredSteps'],
): PlanProblem[] {
  const nodes = [...byKey.values()];
  const ancestorsOf = (node: PlanNodeSpec) => transitiveDependencies(nodes, node.key);

  const problems: PlanProblem[] = [];
  for (const step of requiredSteps) {
    const stepNode = byKey.get(step.key);
    if (step.position === undefined || stepNode === undefined) continue;
    const others = nodes.filter((n) => n.key !== step.key);
    const misplaced = (
      step.position === RequiredStepPosition.First
        ? others.filter((n) => !ancestorsOf(n).has(step.key))
        : others.filter((n) => !ancestorsOf(stepNode).has(n.key))
    ).map((n) => n.key);
    if (misplaced.length > 0) {
      problems.push({
        code: PlanProblemCode.RequiredStepOrder,
        nodeKey: step.key,
        message:
          step.position === RequiredStepPosition.First
            ? `Required first step ${step.key} must be a (transitive) dependency of ${misplaced.join(', ')}`
            : `Required last step ${step.key} must (transitively) depend on ${misplaced.join(', ')}`,
        details: { position: step.position, nodes: misplaced },
      });
    }
  }
  return problems;
}
