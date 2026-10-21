import { InsightsPeriod, type InsightsQuery } from '@aw/shared';
import { addDays, localDateIn, weekdayOf, zonedInstant } from '../../core/time-zone.ts';

/** The instant the date begins in `timeZone`: its 0:00, or the first instant of the date when the clocks skip it. */
export function startOfDay(date: string, timeZone: string): number {
  // When a change skips midnight (America/Havana springs from 23:59 to 1:00), the date begins at the jump.
  return zonedInstant(date, 0, timeZone);
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
        // Monday starts the week.
        const sinceMonday = (weekdayOf(today) + 6) % 7;
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
