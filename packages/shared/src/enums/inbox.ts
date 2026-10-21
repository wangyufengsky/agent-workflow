import { z } from 'zod';

export const InboxKind = {
  Question: 'question',
  Permission: 'permission',
  Acceptance: 'acceptance',
  Plan: 'plan',
  Failure: 'failure',
  Delivery: 'delivery',
  /** A scheduled run could not start its task; belongs to no task (22 §5). */
  ScheduleFailure: 'schedule_failure',
} as const;
export type InboxKind = (typeof InboxKind)[keyof typeof InboxKind];
export const inboxKindSchema = z.enum(InboxKind);

/** Open items of these kinds turn any non-terminal task into the「需要你处理」display group (08 §2.2). */
export const ATTENTION_INBOX_KINDS: readonly InboxKind[] = [
  InboxKind.Question,
  InboxKind.Permission,
  InboxKind.Acceptance,
];

export const InboxStatus = {
  Open: 'open',
  Resolved: 'resolved',
  Dismissed: 'dismissed',
} as const;
export type InboxStatus = (typeof InboxStatus)[keyof typeof InboxStatus];
export const inboxStatusSchema = z.enum(InboxStatus);

/** Same values as opencode's permission reply. */
export const PermissionDecision = {
  Once: 'once',
  Always: 'always',
  Reject: 'reject',
} as const;
export type PermissionDecision = (typeof PermissionDecision)[keyof typeof PermissionDecision];
export const permissionDecisionSchema = z.enum(PermissionDecision);
