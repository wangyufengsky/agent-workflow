import { z } from 'zod';

export const WorkflowKind = {
  Builtin: 'builtin',
  Custom: 'custom',
} as const;
export type WorkflowKind = (typeof WorkflowKind)[keyof typeof WorkflowKind];
export const workflowKindSchema = z.enum(WorkflowKind);

export const WorkflowPlanning = {
  Fixed: 'fixed',
  Ai: 'ai',
} as const;
export type WorkflowPlanning = (typeof WorkflowPlanning)[keyof typeof WorkflowPlanning];
export const workflowPlanningSchema = z.enum(WorkflowPlanning);

export const WorkflowDeliverable = {
  CodeChanges: 'code_changes',
  Report: 'report',
} as const;
export type WorkflowDeliverable = (typeof WorkflowDeliverable)[keyof typeof WorkflowDeliverable];
export const workflowDeliverableSchema = z.enum(WorkflowDeliverable);

export const RoleBaseAgent = {
  Planner: 'planner',
  Executor: 'executor',
  Reviewer: 'reviewer',
} as const;
export type RoleBaseAgent = (typeof RoleBaseAgent)[keyof typeof RoleBaseAgent];
export const roleBaseAgentSchema = z.enum(RoleBaseAgent);

/**
 * Who an attempt's session runs as (12 §2): a role's base agent, the knowledge researcher (18 §5.1) or the PPT writer
 * (23 §7.1).
 */
export const SessionAgent = { ...RoleBaseAgent, Researcher: 'researcher', SlidesWriter: 'slides_writer' } as const;
export type SessionAgent = (typeof SessionAgent)[keyof typeof SessionAgent];

export const RoleKind = {
  Builtin: 'builtin',
  Custom: 'custom',
} as const;
export type RoleKind = (typeof RoleKind)[keyof typeof RoleKind];
export const roleKindSchema = z.enum(RoleKind);

export const NodeKind = {
  Normal: 'normal',
  /** Appended by「让 AI 再改改」/「交给 AI 解决冲突」; depends on every leaf node. */
  Revise: 'revise',
} as const;
export type NodeKind = (typeof NodeKind)[keyof typeof NodeKind];
export const nodeKindSchema = z.enum(NodeKind);

/** Where a workflow's required step must sit in an AI-generated plan. */
export const RequiredStepPosition = {
  First: 'first',
  Last: 'last',
} as const;
export type RequiredStepPosition = (typeof RequiredStepPosition)[keyof typeof RequiredStepPosition];
export const requiredStepPositionSchema = z.enum(RequiredStepPosition);
