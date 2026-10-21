import { z } from 'zod';

/** The time range quality and usage are counted over (19 §2.2). */
export const InsightsPeriod = {
  Today: 'today',
  /** Monday of this week to today. */
  Week: 'week',
  Last7Days: 'last_7_days',
  Last30Days: 'last_30_days',
  /** `from` to `to`, both days included. */
  Custom: 'custom',
} as const;
export type InsightsPeriod = (typeof InsightsPeriod)[keyof typeof InsightsPeriod];
export const INSIGHTS_PERIODS = Object.values(InsightsPeriod);
export const insightsPeriodSchema = z.enum(InsightsPeriod);

/** How usage is broken down (19 §2.3). */
export const InsightsDimension = {
  Project: 'project',
  Workflow: 'workflow',
  Role: 'role',
  Model: 'model',
  Kind: 'kind',
} as const;
export type InsightsDimension = (typeof InsightsDimension)[keyof typeof InsightsDimension];
export const INSIGHTS_DIMENSIONS = Object.values(InsightsDimension);
export const insightsDimensionSchema = z.enum(InsightsDimension);

/** Why a step did not pass (19 §2.4); `attempt_error` comes with the attempt's error code. */
export const InsightsFailureKind = {
  ChecksFailed: 'checks_failed',
  Rejected: 'rejected',
  AttemptError: 'attempt_error',
} as const;
export type InsightsFailureKind = (typeof InsightsFailureKind)[keyof typeof InsightsFailureKind];
export const insightsFailureKindSchema = z.enum(InsightsFailureKind);

/** The metric the page drills into (19 §3.2); the dimensions take the group's key. */
export const InsightsDrill = {
  Completed: 'completed',
  Cancelled: 'cancelled',
  Failed: 'failed',
  FirstPassMissed: 'first_pass_missed',
  Retried: 'retried',
  Interrupted: 'interrupted',
  ReviewDuration: 'review_duration',
  Failure: 'failure',
  ...InsightsDimension,
} as const;
export type InsightsDrill = (typeof InsightsDrill)[keyof typeof InsightsDrill];
export const insightsDrillSchema = z.enum(InsightsDrill);
