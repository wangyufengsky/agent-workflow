import { NODE_INSTRUCTIONS_MAX_CHARS } from '../constants/limits.ts';
import { RoleBaseAgent, WorkflowPlanning } from '../enums/workflow.ts';
import { PlanProblemCode } from '../errors/plan-problems.ts';
import { type WorkflowProblem, WorkflowProblemCode } from '../errors/workflow-problems.ts';
import type { WorkflowDefinition } from './plan-graph.ts';
import { validatePlanGraph } from './validate-plan-graph.ts';

export type WorkflowShape = { planning: WorkflowPlanning; definition: WorkflowDefinition };

/** What validation needs to know about the roles that exist. */
export type RoleRef = { key: string; baseAgent: RoleBaseAgent };

/**
 * Checks a workflow definition against the roles that exist (13 §5): the workflow editor and the backend use the same
 * function. A fixed workflow needs a valid template; an AI-planned one a planner and valid required steps.
 */
export function validateWorkflowDefinition({ planning, definition }: WorkflowShape, roles: readonly RoleRef[]) {
  const problems: WorkflowProblem[] = [];
  const byKey = new Map(roles.map((r) => [r.key, r]));
  if (definition.allowedRoles.length === 0) {
    problems.push({
      code: WorkflowProblemCode.NoAllowedRoles,
      field: 'allowedRoles',
      message: 'A workflow needs at least one role for its steps',
    });
  }
  for (const key of definition.allowedRoles) {
    if (!byKey.has(key)) {
      problems.push({
        code: WorkflowProblemCode.RoleNotFound,
        field: 'allowedRoles',
        message: `Role ${key} does not exist`,
        details: { role: key },
      });
    }
  }
  const rules = { allowedRoles: definition.allowedRoles, requiredSteps: [] };
  if (planning === WorkflowPlanning.Fixed) {
    if (definition.template === undefined) {
      problems.push({
        code: WorkflowProblemCode.MissingTemplate,
        field: 'template',
        message: 'A fixed workflow needs a template plan',
      });
    } else {
      for (const p of validatePlanGraph(definition.template, rules)) problems.push({ ...p, field: 'template' });
    }
    return problems;
  }
  const planner = definition.plannerRole === undefined ? undefined : byKey.get(definition.plannerRole);
  if (definition.plannerRole === undefined) {
    problems.push({
      code: WorkflowProblemCode.MissingPlanner,
      field: 'plannerRole',
      message: 'An AI-planned workflow needs a planner role',
    });
  } else if (planner === undefined) {
    problems.push({
      code: WorkflowProblemCode.RoleNotFound,
      field: 'plannerRole',
      message: `Role ${definition.plannerRole} does not exist`,
      details: { role: definition.plannerRole },
    });
  } else if (planner.baseAgent !== RoleBaseAgent.Planner) {
    problems.push({
      code: WorkflowProblemCode.PlannerRoleInvalid,
      field: 'plannerRole',
      message: `Role ${planner.key} is not a planner`,
      details: { role: planner.key, baseAgent: planner.baseAgent },
    });
  }
  problems.push(...requiredStepProblems(definition));
  return problems;
}

/** Required steps are copied into every AI plan: unique keys, allowed roles, instructions within the limit. */
function requiredStepProblems({ requiredSteps = [], allowedRoles }: WorkflowDefinition): WorkflowProblem[] {
  const problems: WorkflowProblem[] = [];
  const seen = new Set<string>();
  for (const step of requiredSteps) {
    const at = { field: 'requiredSteps', nodeKey: step.key };
    if (seen.has(step.key)) {
      problems.push({ ...at, code: PlanProblemCode.DuplicateKey, message: `Duplicate step key ${step.key}` });
    }
    seen.add(step.key);
    if (!allowedRoles.includes(step.roleKey)) {
      problems.push({
        ...at,
        code: PlanProblemCode.UnknownRole,
        message: `Role ${step.roleKey} is not allowed by this workflow`,
        details: { allowedRoles: [...allowedRoles] },
      });
    }
    if (step.instructions.length > NODE_INSTRUCTIONS_MAX_CHARS) {
      problems.push({
        ...at,
        code: PlanProblemCode.InstructionsTooLong,
        message: `Instructions have ${step.instructions.length} characters, at most ${NODE_INSTRUCTIONS_MAX_CHARS} allowed`,
        details: { max: NODE_INSTRUCTIONS_MAX_CHARS },
      });
    }
  }
  return problems;
}
