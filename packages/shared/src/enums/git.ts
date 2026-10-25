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

/** Whose token signs a project in to its platform (D155): its own binding, or the global one for origin's platform. */
export const HostingSource = {
  Project: 'project',
  Global: 'global',
} as const;
export type HostingSource = (typeof HostingSource)[keyof typeof HostingSource];
export const hostingSourceSchema = z.enum(HostingSource);

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

/** A multi-step git operation the user left unfinished in the main worktree (27 §5). */
export const GitOperation = {
  Merge: 'merge',
  Rebase: 'rebase',
  CherryPick: 'cherry_pick',
  Revert: 'revert',
} as const;
export type GitOperation = (typeof GitOperation)[keyof typeof GitOperation];
export const gitOperationSchema = z.enum(GitOperation);

/** How the Git workbench merges one branch into another (27 §3.5); no rebase there. */
export const GitMergeStrategy = {
  Merge: 'merge',
  Squash: 'squash',
} as const;
export type GitMergeStrategy = (typeof GitMergeStrategy)[keyof typeof GitMergeStrategy];
export const gitMergeStrategySchema = z.enum(GitMergeStrategy);

/** What an AI review in the Git workbench looks at (27 §4.2). */
export const GitReviewTarget = {
  /** Uncommitted changes of the main worktree against HEAD. */
  Worktree: 'worktree',
  Commit: 'commit',
  /** A branch against its merge base with the project's default branch. */
  Branch: 'branch',
  /** Any two refs, from their merge base. */
  Range: 'range',
} as const;
export type GitReviewTarget = (typeof GitReviewTarget)[keyof typeof GitReviewTarget];
export const gitReviewTargetSchema = z.enum(GitReviewTarget);

export const FindingSeverity = {
  Blocker: 'blocker',
  Major: 'major',
  Minor: 'minor',
} as const;
export type FindingSeverity = (typeof FindingSeverity)[keyof typeof FindingSeverity];
export const findingSeveritySchema = z.enum(FindingSeverity);

export const FindingCategory = {
  Correctness: 'correctness',
  Security: 'security',
  Performance: 'performance',
  Maintainability: 'maintainability',
  Tests: 'tests',
} as const;
export type FindingCategory = (typeof FindingCategory)[keyof typeof FindingCategory];
export const findingCategorySchema = z.enum(FindingCategory);

/** Which side of a diff a finding's line numbers count on. */
export const DiffSide = {
  New: 'new',
  Old: 'old',
} as const;
export type DiffSide = (typeof DiffSide)[keyof typeof DiffSide];
export const diffSideSchema = z.enum(DiffSide);
