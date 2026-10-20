import { z } from 'zod';
import {
  roleBaseAgentSchema,
  roleKindSchema,
  workflowDeliverableSchema,
  workflowKindSchema,
  workflowPlanningSchema,
} from '../../enums/workflow.ts';
import { workflowDefinitionSchema } from '../../workflow/plan-graph.ts';

/** `roles` row (10 §roles): who an attempt works as. */
export const roleSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  kind: roleKindSchema,
  baseAgent: roleBaseAgentSchema,
  description: z.string(),
  /** Appended to the agent prompt of every session working as this role (12 §2). */
  prompt: z.string(),
  /** `provider/model`; null falls back to the `ai.defaultModel` setting, then opencode's default. */
  model: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type RoleDTO = z.infer<typeof roleSchema>;

export const updateRoleRequestSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  prompt: z.string().min(1).optional(),
  model: z.string().min(1).nullable().optional(),
});
export type UpdateRoleRequest = z.infer<typeof updateRoleRequestSchema>;

/** One version of a workflow (rows are immutable; editing adds a version). */
export const workflowSummarySchema = z.object({
  id: z.string(),
  key: z.string(),
  version: z.number(),
  kind: workflowKindSchema,
  name: z.string(),
  description: z.string(),
  planning: workflowPlanningSchema,
  deliverable: workflowDeliverableSchema,
  createdAt: z.number(),
});
export type WorkflowSummaryDTO = z.infer<typeof workflowSummarySchema>;

export const workflowSchema = workflowSummarySchema.extend({ definition: workflowDefinitionSchema });
export type WorkflowDTO = z.infer<typeof workflowSchema>;

export const updateWorkflowRequestSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  definition: workflowDefinitionSchema.optional(),
});
export type UpdateWorkflowRequest = z.infer<typeof updateWorkflowRequestSchema>;
