import { defaultGranularity, TEAM_PERIOD_DAYS, TeamGranularity, TeamPeriod } from '@aw/shared';
import { addDays, localDateIn, weekdayOf, zonedInstant } from '../../core/time-zone.ts';

type RangeQuery = {
  period: TeamPeriod;
  from?: string | undefined;
  to?: string | undefined;
  granularity?: TeamGranularity | undefined;
};

export type Bucket = { from: string; to: string };

export type TeamRange = {
  period: TeamPeriod;
  from: string;
  to: string;
  timeZone: string;
  granularity: TeamGranularity;
  /** Oldest first, covering the period without gaps. */
  buckets: Bucket[];
  /** `[start, end)` in milliseconds: from's 0:00 to the 0:00 after `to`. */
  start: number;
  end: number;
  /** The period of the same length just before (33 §3.4). */
  previous: { start: number; end: number };
  /** The bucket a commit's date falls in, by `YYYY-MM-DD`. */
  bucketOf(date: string): number | undefined;
};

const firstOfNextMonth = (date: string) => {
  const [year, month] = date.split('-').map(Number);
  if (year === undefined || month === undefined) throw new Error(`Bad date ${date}`);
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
};

/** Where the bucket holding `date` ends, clipped to `last`. */
function bucketEnd(date: string, granularity: TeamGranularity, last: string): string {
  const end = (() => {
    switch (granularity) {
      case TeamGranularity.Day:
        return date;
      case TeamGranularity.Week:
        // Weeks start on Monday: run to the Sunday.
        return addDays(date, (7 - weekdayOf(date)) % 7);
      case TeamGranularity.Month:
        return addDays(firstOfNextMonth(date), -1);
    }
  })();
  return end < last ? end : last;
}

/** The dates, instants and buckets a query covers at `now` in `timeZone` (33 §4); the query was validated already. */
export function resolveTeamRange(query: RangeQuery, now: number, timeZone: string): TeamRange {
  const today = localDateIn(timeZone)(now);
  const [from, to] =
    query.period === TeamPeriod.Custom
      ? [query.from ?? today, query.to ?? today]
      : [addDays(today, 1 - TEAM_PERIOD_DAYS[query.period]), today];
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
  const granularity = query.granularity ?? defaultGranularity(days);
  const buckets: Bucket[] = [];
  const index = new Map<string, number>();
  for (let date = from; date <= to; ) {
    const end = bucketEnd(date, granularity, to);
    for (let d = date; d <= end; d = addDays(d, 1)) index.set(d, buckets.length);
    buckets.push({ from: date, to: end });
    date = addDays(end, 1);
  }
  const at = (date: string) => zonedInstant(date, 0, timeZone);
  return {
    period: query.period,
    from,
    to,
    timeZone,
    granularity,
    buckets,
    start: at(from),
    end: at(addDays(to, 1)),
    previous: { start: at(addDays(from, -days)), end: at(from) },
    bucketOf: (date) => index.get(date),
  };
}
