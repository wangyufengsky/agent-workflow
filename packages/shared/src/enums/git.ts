import { z } from 'zod';

export const WorktreeStatus = {
  Creating: 'creating',
  Ready: 'ready',
  Removing: 'removing',
  Removed: 'removed',
  Error: 'error',
} as const;
export type WorktreeStatus = (typeof WorktreeStatus)[keyof typeof WorktreeStatus];
export const worktreeStatusSchema = z.enum(WorktreeStatus);

export const DeliveryStrategy = {
  Squash: 'squash',
  Merge: 'merge',
  Rebase: 'rebase',
  PullRequest: 'pull_request',
  ReportOnly: 'report_only',
} as const;
export type DeliveryStrategy = (typeof DeliveryStrategy)[keyof typeof DeliveryStrategy];
export const deliveryStrategySchema = z.enum(DeliveryStrategy);

export const DeliveryStatus = {
  Running: 'running',
  Succeeded: 'succeeded',
  Conflict: 'conflict',
  Failed: 'failed',
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];
export const deliveryStatusSchema = z.enum(DeliveryStatus);

export const HostingProvider = {
  Github: 'github',
  Gitlab: 'gitlab',
} as const;
export type HostingProvider = (typeof HostingProvider)[keyof typeof HostingProvider];
export const hostingProviderSchema = z.enum(HostingProvider);

/** Local merge strategies (09 §7); the others push (pull_request) or merge nothing (report_only). */
export const LOCAL_MERGE_STRATEGIES = [
  DeliveryStrategy.Squash,
  DeliveryStrategy.Merge,
  DeliveryStrategy.Rebase,
] as const;
export type LocalMergeStrategy = (typeof LOCAL_MERGE_STRATEGIES)[number];
export const localMergeStrategySchema = z.enum(LOCAL_MERGE_STRATEGIES);
export const isLocalMerge = (strategy: DeliveryStrategy): strategy is LocalMergeStrategy =>
  LOCAL_MERGE_STRATEGIES.some((s) => s === strategy);

/** Why the user sends a task in review back to the AI (11 §5 `request-changes`). */
export const ChangeRequestReason = {
  /** 「让 AI 再改改」with the user's feedback. */
  User: 'user',
  /** 「交给 AI 解决冲突」after a conflicting merge. */
  Conflict: 'conflict',
  /** 「让 AI 按意见再改改」with review comments of the task's pull request (21 §3); not through `request-changes`. */
  Review: 'review',
} as const;
export type ChangeRequestReason = (typeof ChangeRequestReason)[keyof typeof ChangeRequestReason];
/** The reasons `request-changes` accepts: review comments go through their own operation, which fetches them. */
export const changeRequestReasonSchema = z.enum([ChangeRequestReason.User, ChangeRequestReason.Conflict]);

/** A review comment of a pull request (21 §2.2). */
export const ReviewCommentKind = {
  /** An unresolved review thread, usually on a line of a file. */
  Thread: 'thread',
  /** A comment in the conversation, or the text of a submitted review. */
  General: 'general',
} as const;
export type ReviewCommentKind = (typeof ReviewCommentKind)[keyof typeof ReviewCommentKind];
export const reviewCommentKindSchema = z.enum(ReviewCommentKind);
