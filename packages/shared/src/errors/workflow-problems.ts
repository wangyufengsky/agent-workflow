import { z } from 'zod';
import { planProblemCodeSchema } from './plan-problems.ts';

/**
 * Sub-codes of `WORKFLOW_DEFINITION_INVALID.details.problems[].code` (08 §5.4) besides the plan problems of a fixed
 * workflow's template and of required steps (08 §5.3).
 */
export const WorkflowProblemCode = {
  NoAllowedRoles: 'NO_ALLOWED_ROLES',
  RoleNotFound: 'ROLE_NOT_FOUND',
  MissingPlanner: 'MISSING_PLANNER',
  PlannerRoleInvalid: 'PLANNER_ROLE_INVALID',
  MissingTemplate: 'MISSING_TEMPLATE',
} as const;
export type WorkflowProblemCode = (typeof WorkflowProblemCode)[keyof typeof WorkflowProblemCode];
export const workflowProblemCodeSchema = z.enum(WorkflowProblemCode);

export const workflowProblemSchema = z.object({
  code: z.union([workflowProblemCodeSchema, planProblemCodeSchema]),
  /** `template`, `requiredSteps`, `allowedRoles` or `plannerRole`: the part of the definition with the problem. */
  field: z.string(),
  nodeKey: z.string().optional(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type WorkflowProblem = z.infer<typeof workflowProblemSchema>;
