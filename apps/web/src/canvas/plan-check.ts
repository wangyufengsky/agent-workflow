import { AcceptanceCheckKind, lockedChanges, type PlanGraph, type PlanRules, validatePlanGraph } from '@aw/shared';
import { PLAN_EDITOR_COPY as C, PLAN_PROBLEM_LABEL } from '../copy/plan-editor.ts';

export type EditorProblem = { key: string | undefined; message: string };

/** Locked steps of a plan being adjusted and the plan they come from (09 §2 `paused`). */
export type PlanLock = { base: PlanGraph; locked: ReadonlySet<string> };

/**
 * Everything that keeps an edited plan from being saved: empty fields (the schema's minimum), the shared
 * `validatePlanGraph` problems the backend reports too, and changes to locked steps (NODE_NOT_EDITABLE).
 */
export function checkPlan(graph: PlanGraph, rules: PlanRules, lock: PlanLock | undefined): EditorProblem[] {
  const blank = (text: string) => text.trim() === '';
  const incomplete = graph.nodes
    .filter(
      (n) =>
        blank(n.title) ||
        blank(n.instructions) ||
        (n.acceptance?.checks ?? []).some((c) => c.kind === AcceptanceCheckKind.Command && blank(c.command)),
    )
    .map((n) => ({ key: n.key, message: C.incomplete(n.key) }));
  const problems = validatePlanGraph(graph, rules).map((p) => ({
    key: p.nodeKey,
    message: `${PLAN_PROBLEM_LABEL[p.code]}${p.nodeKey === undefined ? '' : `（${p.nodeKey}）`}`,
  }));
  const changed = lock === undefined ? [] : lockedChanges(lock.base, graph, lock.locked);
  return [
    ...incomplete,
    ...problems,
    ...(changed.length === 0 ? [] : [{ key: undefined, message: C.lockedChanged(changed) }]),
  ];
}
