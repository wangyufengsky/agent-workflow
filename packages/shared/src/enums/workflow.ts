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

export const RoleKind = {
  Builtin: 'builtin',
  Custom: 'custom',
} as const;
export type RoleKind = (typeof RoleKind)[keyof typeof RoleKind];
export const roleKindSchema = z.enum(RoleKind);
