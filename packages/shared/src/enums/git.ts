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
