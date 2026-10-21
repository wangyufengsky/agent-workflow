import { InsightsPeriod, type InsightsQuery } from '@aw/shared';

const DAY_MS = 86_400_000;
/** Sampling this far before and after local midnight sees the offsets on both sides of a change near it. */
const SIX_HOURS = 21_600_000;

/** Calendar arithmetic on `YYYY-MM-DD`, independent of any time zone. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The date of each instant in `timeZone`; one formatter per zone, as it runs for every counted row. */
export function localDateIn(timeZone: string): (ms: number) => string {
  // en-CA writes dates as YYYY-MM-DD.
  const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return (ms) => format.format(ms);
}

/** How far the zone's wall clock is ahead of UTC at `ms`. */
function offsetAt(ms: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    })
      .formatToParts(ms)
      .map((p) => [p.type, Number(p.value)]),
  );
  const wall = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return wall - (ms - (ms % 1000));
}

/** The instant the date begins in `timeZone`: its 0:00, or the first instant of the date when the clocks skip it. */
export function startOfDay(date: string, timeZone: string): number {
  const midnightUtc = Date.parse(date);
  const dateOf = localDateIn(timeZone);
  const guess = midnightUtc - offsetAt(midnightUtc, timeZone);
  // Local midnight in the offset before and in the offset after a change near it. When the change skips midnight
  // (America/Havana springs from 23:59 to 1:00), only the earlier offset lands on the date, at the jump.
  const starts = [guess - SIX_HOURS, guess + SIX_HOURS]
    .map((t) => midnightUtc - offsetAt(t, timeZone))
    .filter((t) => dateOf(t) === date);
  if (starts.length === 0) throw new Error(`No start of ${date} in ${timeZone}`);
  return Math.min(...starts);
}

export type ResolvedPeriod = {
  period: InsightsPeriod;
  from: string;
  to: string;
  timeZone: string;
  /** Every date of the period, oldest first. */
  dates: string[];
  /** `[start, end)` in milliseconds: from's 0:00 to the 0:00 after `to`. */
  start: number;
  end: number;
};

/** The dates and instants a query covers at `now` in `timeZone` (19 §2.2); the query was validated already. */
export function resolvePeriod(query: InsightsQuery, now: number, timeZone: string): ResolvedPeriod {
  const today = localDateIn(timeZone)(now);
  const range = (): [string, string] => {
    switch (query.period) {
      case InsightsPeriod.Today:
        return [today, today];
      case InsightsPeriod.Week: {
        // getUTCDay of a bare date is its weekday; Monday starts the week.
        const sinceMonday = (new Date(Date.parse(today)).getUTCDay() + 6) % 7;
        return [addDays(today, -sinceMonday), today];
      }
      case InsightsPeriod.Last7Days:
        return [addDays(today, -6), today];
      case InsightsPeriod.Last30Days:
        return [addDays(today, -29), today];
      case InsightsPeriod.Custom:
        if (query.from === undefined || query.to === undefined) throw new Error('custom period without dates');
        return [query.from, query.to];
    }
  };
  const [from, to] = range();
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return {
    period: query.period,
    from,
    to,
    timeZone,
    dates,
    start: startOfDay(from, timeZone),
    end: startOfDay(addDays(to, 1), timeZone),
  };
}
