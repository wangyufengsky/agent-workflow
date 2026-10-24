import { INITIATIVE_TEMPLATE_PLACEHOLDER } from '../constants/app.ts';
import type { InitiativeDraft } from '../contracts/api/initiatives.ts';
import { type InitiativeProblem, InitiativeProblemCode } from '../errors/initiative-problems.ts';
import { findCycles } from '../workflow/validate-plan-graph.ts';

export type InitiativeDraftRules = {
  /** Whether a workflow key names a workflow a work package may run (not a system one). */
  workflowExists: (key: string) => boolean;
  /** A composition template: some work package must take the user's requirement (34 §15.2). */
  template?: boolean;
};

/**
 * The rules of phases and work packages (34 §8.3), shared by templates, the user's edits and (later) the AI's
 * breakdown. Lengths and counts are the schema's; this checks how the parts fit together.
 */
export function validateInitiativeDraft(draft: InitiativeDraft, rules: InitiativeDraftRules): InitiativeProblem[] {
  const problems: InitiativeProblem[] = [];
  const byKey = new Map<string, InitiativeDraft['items'][number]>();
  for (const item of draft.items) {
    if (byKey.has(item.key)) {
      problems.push({
        code: InitiativeProblemCode.DuplicateKey,
        itemKey: item.key,
        message: `Work package key ${item.key} is used twice`,
      });
    }
    byKey.set(item.key, item);
  }

  for (const item of draft.items) {
    if (item.phase > draft.phases.length) {
      problems.push({
        code: InitiativeProblemCode.PhaseOutOfRange,
        itemKey: item.key,
        message: `Phase ${item.phase} does not exist; there are ${draft.phases.length}`,
      });
    }
    if (!rules.workflowExists(item.workflow)) {
      problems.push({
        code: InitiativeProblemCode.UnknownWorkflow,
        itemKey: item.key,
        message: `Workflow ${item.workflow} does not exist`,
        details: { workflow: item.workflow },
      });
    }
    for (const key of item.dependsOn) {
      const dependency = byKey.get(key);
      if (dependency === undefined) {
        problems.push({
          code: InitiativeProblemCode.UnknownDependency,
          itemKey: item.key,
          message: `${item.key} depends on ${key}, which does not exist`,
        });
      } else if (dependency.phase > item.phase) {
        problems.push({
          code: InitiativeProblemCode.DependencyPhase,
          itemKey: item.key,
          message: `${item.key} (phase ${item.phase}) depends on ${key} of the later phase ${dependency.phase}`,
        });
      }
    }
  }

  draft.phases.forEach((_, i) => {
    if (!draft.items.some((item) => item.phase === i + 1)) {
      problems.push({ code: InitiativeProblemCode.EmptyPhase, message: `Phase ${i + 1} has no work package` });
    }
  });

  for (const cycle of findCycles(byKey)) {
    problems.push({
      code: InitiativeProblemCode.Cycle,
      itemKey: cycle[0],
      message: `Dependency cycle ${cycle.join(' -> ')}`,
      details: { cycle },
    });
  }

  if (
    rules.template === true &&
    !draft.items.some((item) => item.requirement.includes(INITIATIVE_TEMPLATE_PLACEHOLDER))
  ) {
    problems.push({
      code: InitiativeProblemCode.TemplateRequirementMissing,
      message: `No work package's requirement contains ${INITIATIVE_TEMPLATE_PLACEHOLDER}`,
    });
  }
  return problems;
}

/**
 * A template's work packages for one requirement: every placeholder replaced by it (34 §15.2), literally — a
 * replacement string would read `$&` and the like in the user's text as patterns.
 */
export const renderTemplateRequirement = (requirement: string, userRequirement: string): string =>
  requirement.replaceAll(INITIATIVE_TEMPLATE_PLACEHOLDER, () => userRequirement);
