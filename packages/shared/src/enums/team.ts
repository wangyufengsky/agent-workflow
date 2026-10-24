import { z } from 'zod';

/** The time range the team page counts (33 §4.1). */
export const TeamPeriod = {
  Last30Days: 'last_30_days',
  Last90Days: 'last_90_days',
  Last180Days: 'last_180_days',
  Last365Days: 'last_365_days',
  /** `from` to `to`, both days included. */
  Custom: 'custom',
} as const;
export type TeamPeriod = (typeof TeamPeriod)[keyof typeof TeamPeriod];
export const TEAM_PERIODS = Object.values(TeamPeriod);
export const teamPeriodSchema = z.enum(TeamPeriod);

/** How a period is cut for the trends (33 §4.2); weeks start on Monday. */
export const TeamGranularity = {
  Day: 'day',
  Week: 'week',
  Month: 'month',
} as const;
export type TeamGranularity = (typeof TeamGranularity)[keyof typeof TeamGranularity];
export const TEAM_GRANULARITIES = Object.values(TeamGranularity);
export const teamGranularitySchema = z.enum(TeamGranularity);

/** What a commit is about, from its subject's prefix (33 §3.3). */
export const TeamWorkType = {
  Feature: 'feature',
  Fix: 'fix',
  Test: 'test',
  Refactor: 'refactor',
  Docs: 'docs',
  Chore: 'chore',
  Other: 'other',
} as const;
export type TeamWorkType = (typeof TeamWorkType)[keyof typeof TeamWorkType];
export const TEAM_WORK_TYPES = Object.values(TeamWorkType);
export const teamWorkTypeSchema = z.enum(TeamWorkType);

/** An AI member analysis (33 §6.4, 09): one project runs one at a time, the others wait in line. */
export const TeamAnalysisStatus = {
  Queued: 'queued',
  Running: 'running',
  Succeeded: 'succeeded',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;
export type TeamAnalysisStatus = (typeof TeamAnalysisStatus)[keyof typeof TeamAnalysisStatus];
export const teamAnalysisStatusSchema = z.enum(TeamAnalysisStatus);

/** Who else is counted beside the members (33 §2.3): this app's AI tasks, and identities set as not members. */
export const TeamOtherKind = {
  AiTask: 'ai_task',
  Hidden: 'hidden',
} as const;
export type TeamOtherKind = (typeof TeamOtherKind)[keyof typeof TeamOtherKind];
export const teamOtherKindSchema = z.enum(TeamOtherKind);
