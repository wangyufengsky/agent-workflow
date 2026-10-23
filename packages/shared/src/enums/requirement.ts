import { z } from 'zod';

/** How an item of a task's acceptance checklist is verified (31 §2). */
export const RequirementVerification = {
  /** A command the verify step runs; exit code 0 passes. */
  Command: 'command',
  /** The read-only verify step judges it. */
  AiReview: 'ai_review',
  /** The user confirms it on the result card. */
  Manual: 'manual',
} as const;
export type RequirementVerification = (typeof RequirementVerification)[keyof typeof RequirementVerification];
export const requirementVerificationKindSchema = z.enum(RequirementVerification);

/** Who gave a conclusion on an item (31 §3). */
export const RequirementResultSource = {
  Command: 'command',
  Ai: 'ai',
  User: 'user',
} as const;
export type RequirementResultSource = (typeof RequirementResultSource)[keyof typeof RequirementResultSource];
export const requirementResultSourceSchema = z.enum(RequirementResultSource);

/** A conclusion on an item: commands and the AI give pass / fail / unverified, the user pass / fail / waive. */
export const RequirementConclusion = {
  Pass: 'pass',
  Fail: 'fail',
  Unverified: 'unverified',
  /** The user accepts the item as not done, with a reason. */
  Waive: 'waive',
} as const;
export type RequirementConclusion = (typeof RequirementConclusion)[keyof typeof RequirementConclusion];
export const requirementConclusionSchema = z.enum(RequirementConclusion);

/** An item's state as shown (31 §3): computed from the results, never stored. */
export const RequirementDisplayStatus = {
  Passed: 'passed',
  Failed: 'failed',
  Unverified: 'unverified',
  /** Its latest conclusion was for another checklist version or another commit. */
  Stale: 'stale',
  Waived: 'waived',
} as const;
export type RequirementDisplayStatus = (typeof RequirementDisplayStatus)[keyof typeof RequirementDisplayStatus];
export const requirementDisplayStatusSchema = z.enum(RequirementDisplayStatus);
