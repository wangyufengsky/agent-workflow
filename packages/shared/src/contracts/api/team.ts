import { z } from 'zod';
import { TEAM_MAX_BUCKETS, TEAM_MAX_DAYS } from '../../constants/team.ts';
import {
  TeamGranularity,
  TeamPeriod,
  teamGranularitySchema,
  teamOtherKindSchema,
  teamPeriodSchema,
  teamWorkTypeSchema,
} from '../../enums/team.ts';

const DAY_MS = 86_400_000;
/** Days from `from` to `to`, both included (calendar dates, no time zone involved). */
const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;

/** Days of the fixed periods (33 §4.1). */
export const TEAM_PERIOD_DAYS = {
  [TeamPeriod.Last30Days]: 30,
  [TeamPeriod.Last90Days]: 90,
  [TeamPeriod.Last180Days]: 180,
  [TeamPeriod.Last365Days]: 365,
} as const;

/** The granularity a period gets when none is asked for (33 §4.2). */
export function defaultGranularity(days: number): TeamGranularity {
  if (days <= 31) return TeamGranularity.Day;
  if (days <= 180) return TeamGranularity.Week;
  return TeamGranularity.Month;
}

/** What the team page counts: a project's branch over a period; the branch is the project's default when left out. */
const teamRangeShape = {
  id: z.string(),
  ref: z.string().min(1).optional(),
  period: teamPeriodSchema,
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  granularity: teamGranularitySchema.optional(),
};

type TeamRange = {
  period: TeamPeriod;
  from?: string | undefined;
  to?: string | undefined;
  granularity?: TeamGranularity | undefined;
};

function refineRange({ period, from, to, granularity }: TeamRange, ctx: z.RefinementCtx) {
  let days: number;
  if (period !== TeamPeriod.Custom) {
    if (from !== undefined || to !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'from and to go with the custom period only', path: ['from'] });
      return;
    }
    days = TEAM_PERIOD_DAYS[period];
  } else {
    if (from === undefined || to === undefined) {
      ctx.addIssue({ code: 'custom', message: 'The custom period needs from and to', path: ['from'] });
      return;
    }
    days = daysBetween(from, to);
    if (days < 1) ctx.addIssue({ code: 'custom', message: 'from is after to', path: ['to'] });
    if (days > TEAM_MAX_DAYS) ctx.addIssue({ code: 'custom', message: `At most ${TEAM_MAX_DAYS} days`, path: ['to'] });
  }
  // Weeks and months of the longest period stay under the limit; only days can pass it.
  if (granularity === TeamGranularity.Day && days > TEAM_MAX_BUCKETS) {
    ctx.addIssue({ code: 'custom', message: `At most ${TEAM_MAX_BUCKETS} days by day`, path: ['granularity'] });
  }
}

/** `GET /projects/:id/team` (33 §8.1). */
export const teamQuerySchema = z.object(teamRangeShape).superRefine(refineRange);
export type TeamQuery = z.infer<typeof teamQuerySchema>;

/** `GET /projects/:id/team/members/:member`: `member` is the member's main email. */
export const teamMemberQuerySchema = z
  .object({ ...teamRangeShape, member: z.string().min(1) })
  .superRefine(refineRange);
export type TeamMemberQuery = z.infer<typeof teamMemberQuerySchema>;

/** `GET /projects/:id/team/commits`: a member's commits in the period, newest first, by pages. */
export const teamCommitsQuerySchema = z
  .object({ ...teamRangeShape, member: z.string().min(1), cursor: z.string().optional() })
  .superRefine(refineRange);
export type TeamCommitsQuery = z.infer<typeof teamCommitsQuerySchema>;

const ratio = z.number().min(0).max(1).nullable();

/** One person's or the team's figures over a period (33 §3). */
export const teamMetricsSchema = z.object({
  commits: z.number(),
  activeDays: z.number(),
  /** Lines of counted files, huge commits left out (33 §2.4). */
  added: z.number(),
  deleted: z.number(),
  files: z.number(),
  /** Median counted lines (added + deleted) per commit. */
  commitLinesMedian: z.number().nullable(),
  /** Commits whose lines were left out for being huge. */
  hugeCommits: z.number(),
  /** Commits changing counted files that are not tests, and those of them that also change tests. */
  codeCommits: z.number(),
  testCommits: z.number(),
  testRate: ratio,
  /** Commits later reverted on the branch. */
  reverted: z.number(),
  /** Commits with an AI mark (33 §2.5), and those of them made by this app's tasks the person started. */
  aiCommits: z.number(),
  taskCommits: z.number(),
  workMix: z.record(teamWorkTypeSchema, z.number()),
});
export type TeamMetricsDTO = z.infer<typeof teamMetricsSchema>;

/** Medians across the members with a commit in the period; null without any. */
export const teamMediansSchema = z.object({
  commits: z.number().nullable(),
  activeDays: z.number().nullable(),
  added: z.number().nullable(),
  deleted: z.number().nullable(),
  files: z.number().nullable(),
  commitLinesMedian: z.number().nullable(),
  testRate: z.number().nullable(),
  reverted: z.number().nullable(),
  aiCommits: z.number().nullable(),
});
export type TeamMediansDTO = z.infer<typeof teamMediansSchema>;

/** One bucket of a trend. */
export const teamPointSchema = z.object({
  commits: z.number(),
  added: z.number(),
  deleted: z.number(),
  codeCommits: z.number(),
  testCommits: z.number(),
});
export type TeamPointDTO = z.infer<typeof teamPointSchema>;

export const teamMemberSchema = z.object({
  /** The main identity's email. */
  key: z.string(),
  name: z.string(),
  emails: z.array(z.string()),
  metrics: teamMetricsSchema,
  /** The period of the same length just before. */
  previous: teamMetricsSchema,
  /** One point per bucket. */
  series: z.array(teamPointSchema),
});
export type TeamMemberDTO = z.infer<typeof teamMemberSchema>;

export const teamOtherSchema = z.object({
  key: z.string(),
  kind: teamOtherKindSchema,
  name: z.string(),
  emails: z.array(z.string()),
  metrics: teamMetricsSchema,
});
export type TeamOtherDTO = z.infer<typeof teamOtherSchema>;

export const teamDirectorySchema = z.object({
  path: z.string(),
  lines: z.number(),
  /** The members' counted lines in it, most first. */
  members: z.array(z.object({ key: z.string(), lines: z.number() })),
});
export type TeamDirectoryDTO = z.infer<typeof teamDirectorySchema>;

/** What the figures are of: the branch and its newest commit, the period and its buckets. */
const teamScopeShape = {
  ref: z.string(),
  /** The branch's newest commit; null for a branch with no commits. */
  tip: z.object({ sha: z.string(), committedAt: z.number() }).nullable(),
  /** When the repository last fetched (`FETCH_HEAD`), null if never. */
  fetchedAt: z.number().nullable(),
  period: z.object({ period: teamPeriodSchema, from: z.iso.date(), to: z.iso.date(), timeZone: z.string() }),
  granularity: teamGranularitySchema,
  buckets: z.array(z.object({ from: z.iso.date(), to: z.iso.date() })),
};

export const teamSummarySchema = z.object({
  ...teamScopeShape,
  totals: teamMetricsSchema,
  previousTotals: teamMetricsSchema,
  medians: teamMediansSchema,
  /** By name. */
  members: z.array(teamMemberSchema),
  others: z.array(teamOtherSchema),
  directories: z.array(teamDirectorySchema),
});
export type TeamSummaryDTO = z.infer<typeof teamSummarySchema>;

export const teamIdentitySchema = z.object({
  email: z.string(),
  /** The newest author name seen with the email. */
  authorName: z.string(),
  /** The main identity it is merged into; null for a main identity. */
  memberEmail: z.string().nullable(),
  displayName: z.string().nullable(),
  hidden: z.boolean(),
});
export type TeamIdentityDTO = z.infer<typeof teamIdentitySchema>;

export const teamMemberDetailSchema = z.object({
  ...teamScopeShape,
  member: teamMemberSchema,
  /** Whether the main identity is set as not a member (33 §2.3). */
  hidden: z.boolean(),
  identities: z.array(teamIdentitySchema),
  medians: teamMediansSchema,
  directories: z.array(z.object({ path: z.string(), lines: z.number() })),
});
export type TeamMemberDetailDTO = z.infer<typeof teamMemberDetailSchema>;

export const teamCommitSchema = z.object({
  sha: z.string(),
  subject: z.string(),
  authorName: z.string(),
  authorEmail: z.string(),
  authoredAt: z.number(),
  /** Counted lines; zero for a huge commit. */
  added: z.number(),
  deleted: z.number(),
  files: z.number(),
  workType: teamWorkTypeSchema,
  huge: z.boolean(),
  reverted: z.boolean(),
  ai: z.boolean(),
  /** Made by this app's task the member started (D130). */
  viaTask: z.boolean(),
});
export type TeamCommitDTO = z.infer<typeof teamCommitSchema>;

/** `PUT /projects/:id/team/identities`: change one identity; left-out fields stay as they are. */
export const teamIdentityUpdateSchema = z.object({
  id: z.string(),
  email: z.string().min(1),
  /** Merge into this main identity; null makes the identity its own member again. */
  memberEmail: z.string().min(1).nullable().optional(),
  displayName: z.string().trim().min(1).max(60).nullable().optional(),
  hidden: z.boolean().optional(),
});
export type TeamIdentityUpdate = z.infer<typeof teamIdentityUpdateSchema>;

const globList = z.array(z.string().trim().min(1).max(200)).max(100);

/** How lines are counted for a project (33 §2.4). */
export const teamSettingsSchema = z.object({
  excludeGlobs: globList,
  testGlobs: globList,
  hugeCommitLines: z.number().int().min(1),
});
export type TeamSettingsDTO = z.infer<typeof teamSettingsSchema>;

/** `PUT /projects/:id/team/settings`: null puts a field back to the default. */
export const teamSettingsUpdateSchema = z.object({
  id: z.string(),
  excludeGlobs: globList.nullable().optional(),
  testGlobs: globList.nullable().optional(),
  hugeCommitLines: z.number().int().min(1).max(1_000_000).nullable().optional(),
});
export type TeamSettingsUpdate = z.infer<typeof teamSettingsUpdateSchema>;
