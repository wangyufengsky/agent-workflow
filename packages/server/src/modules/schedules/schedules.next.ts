import { type ScheduleFrequency, scheduleRunsOn, scheduleTimesOfDay } from '@aw/shared';
import { addDays, localDateIn, weekdayOf, zonedInstant } from '../../core/time-zone.ts';

/** A weekly schedule runs at least once in any eight consecutive days, counting the day before `after`. */
const DAYS_SEARCHED = 9;

/** The first time after `after` a schedule runs, on the wall clock of `timeZone` (22 §2, D90). */
export function nextRunAfter(frequency: ScheduleFrequency, after: number, timeZone: string): number {
  // From the day before: a time the clocks skip can move a run of that day past midnight.
  const first = addDays(localDateIn(timeZone)(after), -1);
  const times = scheduleTimesOfDay(frequency);
  for (let day = 0; day < DAYS_SEARCHED; day++) {
    const date = addDays(first, day);
    if (!scheduleRunsOn(frequency, weekdayOf(date))) continue;
    // A skipped time moves on and may pass a later one of the same day: the earliest instant wins.
    const later = times.map((minutes) => zonedInstant(date, minutes, timeZone)).filter((at) => at > after);
    if (later.length > 0) return Math.min(...later);
  }
  throw new Error(`No run of ${JSON.stringify(frequency)} within ${DAYS_SEARCHED} days`);
}

/**
 * The scheduled time a due schedule now runs for: the latest one up to `now`, starting from `nextRunAt`; the earlier
 * ones are folded into it as missed (22 §4, D91).
 */
export function foldDueTimes(
  frequency: ScheduleFrequency,
  nextRunAt: number,
  now: number,
  timeZone: string,
): { dueAt: number; missed: number } {
  let dueAt = nextRunAt;
  let missed = 0;
  for (let at = nextRunAfter(frequency, dueAt, timeZone); at <= now; at = nextRunAfter(frequency, at, timeZone)) {
    dueAt = at;
    missed++;
  }
  return { dueAt, missed };
}
