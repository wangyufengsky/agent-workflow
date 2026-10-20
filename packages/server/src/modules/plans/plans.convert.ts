import {
  type Acceptance,
  AcceptanceCheckKind,
  type PlanGraph,
  type PlanProblem,
  type SubmitPlanInput,
  validatePlanGraph,
  type WorkflowDefinition,
} from '@aw/shared';

type NodeAcceptanceInput = NonNullable<SubmitPlanInput['nodes'][number]['acceptance']>;

/** The model's shorthand (`command` / `ai_review` / `manual`) as an acceptance definition. */
function toAcceptance(input: NodeAcceptanceInput): Acceptance {
  return {
    checks: [
      ...(input.command === undefined ? [] : [{ kind: AcceptanceCheckKind.Command, command: input.command }]),
      ...(input.ai_review === true ? [{ kind: AcceptanceCheckKind.AiReview }] : []),
    ],
    manual: input.manual ?? false,
  };
}

/**
 * `submit_plan` input as a plan graph. A required step keeps the title, role and acceptance the workflow defines;
 * the model only refines its instructions and dependencies (12 §6.4).
 */
export function planGraphFromSubmission(input: SubmitPlanInput, definition: WorkflowDefinition): PlanGraph {
  const required = new Map((definition.requiredSteps ?? []).map((step) => [step.key, step]));
  return {
    nodes: input.nodes.map((node) => {
      const step = required.get(node.key);
      const acceptance =
        step?.acceptance ?? (node.acceptance === undefined ? undefined : toAcceptance(node.acceptance));
      return {
        key: node.key,
        title: step?.title ?? node.title,
        roleKey: step?.roleKey ?? node.role,
        instructions: node.instructions,
        dependsOn: node.depends_on ?? [],
        ...(acceptance === undefined ? {} : { acceptance }),
      };
    }),
  };
}

/** Problems of an AI plan against the workflow's rules (08 §5.3); empty when valid. */
export function validateSubmission(input: SubmitPlanInput, definition: WorkflowDefinition): PlanProblem[] {
  // Roles are checked as the model wrote them: a required step with a wrong role is still the model's mistake.
  const asWritten: PlanGraph = {
    nodes: input.nodes.map((n) => ({
      key: n.key,
      title: n.title,
      roleKey: n.role,
      instructions: n.instructions,
      dependsOn: n.depends_on ?? [],
    })),
  };
  return validatePlanGraph(asWritten, {
    allowedRoles: definition.allowedRoles,
    requiredSteps: definition.requiredSteps ?? [],
  });
}
