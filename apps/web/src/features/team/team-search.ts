import {
  defaultGranularity,
  TEAM_MAX_BUCKETS,
  TEAM_PERIOD_DAYS,
  TeamGranularity,
  TeamPeriod,
  type TeamQuery,
  teamGranularitySchema,
  teamPeriodSchema,
} from '@aw/shared';
import { z } from 'zod';

/** The team pages' search (33 §5.1): branch, period and buckets stay in the address, also across projects. */
export const teamSearchSchema = z.object({
  ref: z.string().optional(),
  period: teamPeriodSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  granularity: teamGranularitySchema.optional(),
});
export type TeamSearch = z.infer<typeof teamSearchSchema>;

const DAY_MS = 86_400_000;
/** A date of the user's calendar, as the backend counts days in the same (system) time zone. */
export const localDate = (ms: number) => new Date(ms).toLocaleDateString('en-CA');

/** Days the search covers; a custom period without dates is the last 30 days. */
export function daysOf(query: TeamQuery): number {
  if (query.period !== TeamPeriod.Custom) return TEAM_PERIOD_DAYS[query.period];
  return (Date.parse(query.to ?? '') - Date.parse(query.from ?? '')) / DAY_MS + 1;
}

/** The query a search asks for; buckets by day that would be too many fall back to the default. */
export function teamQueryOf(projectId: string, search: TeamSearch): TeamQuery {
  const period = search.period ?? TeamPeriod.Last30Days;
  const query: TeamQuery =
    period === TeamPeriod.Custom
      ? {
          id: projectId,
          period,
          from: search.from ?? localDate(Date.now() - 29 * DAY_MS),
          to: search.to ?? localDate(Date.now()),
        }
      : { id: projectId, period };
  if (search.ref !== undefined) query.ref = search.ref;
  const tooMany = search.granularity === TeamGranularity.Day && daysOf(query) > TEAM_MAX_BUCKETS;
  if (search.granularity !== undefined && !tooMany) query.granularity = search.granularity;
  return query;
}

/** The granularity the backend uses for the query (33 §4.2). */
export const granularityOf = (query: TeamQuery) => query.granularity ?? defaultGranularity(daysOf(query));
