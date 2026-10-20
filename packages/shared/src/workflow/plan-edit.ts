import { NodeStatus } from '../enums/task.ts';
import { NodeKind } from '../enums/workflow.ts';
import type { PlanGraph, PlanNodeSpec, WorkflowDefinition } from './plan-graph.ts';
import type { PlanRules } from './validate-plan-graph.ts';

/** Steps a plan adjustment may change or remove (09 §2 `paused`): nothing has started working on them. */
export const EDITABLE_NODE_STATUSES: readonly NodeStatus[] = [NodeStatus.Pending, NodeStatus.Ready];

/**
 * Rules a user-edited plan is validated with, by the plan editor and the backend alike (14 §5). Roles already in the
 * plan stay allowed: system steps (13 §4) use roles a workflow need not list.
 */
export function planEditRules(definition: WorkflowDefinition, base: PlanGraph): PlanRules {
  return {
    allowedRoles: [...new Set([...definition.allowedRoles, ...base.nodes.map((n) => n.roleKey)])],
    requiredSteps: definition.requiredSteps ?? [],
  };
}

/** What a step does, independent of field order, default values and dependency order. */
function definitionOf(spec: PlanNodeSpec): string {
  return JSON.stringify([
    spec.title,
    spec.roleKey,
    spec.instructions,
    [...spec.dependsOn].sort(),
    spec.acceptance ?? null,
    spec.kind ?? NodeKind.Normal,
  ]);
}

/** Keys of locked steps (already started) that `next` changes or removes compared with `base`; empty when none. */
export function lockedChanges(base: PlanGraph, next: PlanGraph, locked: ReadonlySet<string>): string[] {
  const nextByKey = new Map(next.nodes.map((n) => [n.key, n]));
  return base.nodes
    .filter((n) => locked.has(n.key))
    .filter((n) => {
      const edited = nextByKey.get(n.key);
      return edited === undefined || definitionOf(edited) !== definitionOf(n);
    })
    .map((n) => n.key);
}
