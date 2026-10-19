import { z } from 'zod';
import { AcceptanceCheckKind } from '../enums/task.ts';
import { nodeKindSchema, requiredStepPositionSchema } from '../enums/workflow.ts';

export const NODE_KEY_PATTERN = /^[a-z0-9_]{1,40}$/;

export const acceptanceCheckSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal(AcceptanceCheckKind.Command), command: z.string().min(1) }),
  z.object({ kind: z.literal(AcceptanceCheckKind.AiReview), focus: z.string().min(1).optional() }),
]);
export type AcceptanceCheck = z.infer<typeof acceptanceCheckSchema>;

export const acceptanceSchema = z.object({
  checks: z.array(acceptanceCheckSchema),
  manual: z.boolean(),
});
export type Acceptance = z.infer<typeof acceptanceSchema>;

// Size limits (node count, instruction length) are plan problems reported by validatePlanGraph, not schema errors,
// so the model receives PLAN_INVALID with a hint instead of a generic validation failure.
export const planNodeSpecSchema = z.object({
  key: z.string().regex(NODE_KEY_PATTERN),
  title: z.string().min(1),
  roleKey: z.string().min(1),
  instructions: z.string().min(1),
  dependsOn: z.array(z.string()),
  acceptance: acceptanceSchema.optional(),
  kind: nodeKindSchema.optional(),
});
export type PlanNodeSpec = z.infer<typeof planNodeSpecSchema>;

export const planGraphSchema = z.object({ nodes: z.array(planNodeSpecSchema) });
export type PlanGraph = z.infer<typeof planGraphSchema>;

export const requiredStepSchema = planNodeSpecSchema.extend({ position: requiredStepPositionSchema.optional() });
export type RequiredStep = z.infer<typeof requiredStepSchema>;

export const workflowCheckpointsSchema = z.object({ confirm_plan: z.boolean(), accept_each_node: z.boolean() });

/** `workflows.definition` (10 §workflows). */
export const workflowDefinitionSchema = z.object({
  allowedRoles: z.array(z.string().min(1)),
  plannerRole: z.string().min(1).optional(),
  plannerGuidance: z.string().optional(),
  requiredSteps: z.array(requiredStepSchema).optional(),
  template: planGraphSchema.optional(),
  checkpoints: workflowCheckpointsSchema,
  defaultAcceptance: acceptanceSchema,
});
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
