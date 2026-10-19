import { z } from 'zod';

/** Sub-codes of `PLAN_INVALID.details.problems[].code` (08 §5.3). */
export const PlanProblemCode = {
  Empty: 'EMPTY',
  TooManyNodes: 'TOO_MANY_NODES',
  DuplicateKey: 'DUPLICATE_KEY',
  UnknownDependency: 'UNKNOWN_DEPENDENCY',
  Cycle: 'CYCLE',
  UnknownRole: 'UNKNOWN_ROLE',
  MissingRequiredStep: 'MISSING_REQUIRED_STEP',
  RequiredStepOrder: 'REQUIRED_STEP_ORDER',
  InstructionsTooLong: 'INSTRUCTIONS_TOO_LONG',
} as const;
export type PlanProblemCode = (typeof PlanProblemCode)[keyof typeof PlanProblemCode];
export const planProblemCodeSchema = z.enum(PlanProblemCode);

/** Hint returned to the model with each problem: how to fix the plan. */
export const PLAN_PROBLEM_HINT = {
  [PlanProblemCode.Empty]: 'Submit at least one node.',
  [PlanProblemCode.TooManyNodes]: 'Merge closely related steps into one node.',
  [PlanProblemCode.DuplicateKey]: 'Node keys must be unique within the plan.',
  [PlanProblemCode.UnknownDependency]: 'Check the spelling of depends_on keys.',
  [PlanProblemCode.Cycle]: 'Remove the dependency that closes the cycle.',
  [PlanProblemCode.UnknownRole]: 'Pick a role from details.allowedRoles.',
  [PlanProblemCode.MissingRequiredStep]: 'Add the step given in details.requiredStep.',
  [PlanProblemCode.RequiredStepOrder]: 'Adjust depends_on so required first/last steps come first/last.',
  [PlanProblemCode.InstructionsTooLong]: 'Shorten the node instructions.',
} as const satisfies Record<PlanProblemCode, string>;

export const planProblemSchema = z.object({
  code: planProblemCodeSchema,
  nodeKey: z.string().optional(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type PlanProblem = z.infer<typeof planProblemSchema>;
