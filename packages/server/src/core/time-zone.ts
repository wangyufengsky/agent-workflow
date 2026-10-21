/** Wall-clock arithmetic in an IANA time zone with `Intl` only (quality and usage 19 §2.2, scheduled tasks 22 §2). */

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** Sampling this far before and after an instant sees the offsets on both sides of a change near it. */
const SIX_HOURS = 21_600_000;

/** Calendar arithmetic on `YYYY-MM-DD`, independent of any time zone. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Day of the week of a `YYYY-MM-DD`, 0 = Sunday. */
export function weekdayOf(date: string): number {
  return new Date(Date.parse(date)).getUTCDay();
}

/** The date of each instant in `timeZone`; one formatter per zone, as it runs for every counted row. */
export function localDateIn(timeZone: string): (ms: number) => string {
  // en-CA writes dates as YYYY-MM-DD.
  const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return (ms) => format.format(ms);
}

/** Creating a formatter costs far more than using one; a schedule's missed times are counted one by one (22 §4). */
const wallClocks = new Map<string, Intl.DateTimeFormat>();
function wallClockIn(timeZone: string): Intl.DateTimeFormat {
  let format = wallClocks.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    });
    wallClocks.set(timeZone, format);
  }
  return format;
}

/** How far the zone's wall clock is ahead of UTC at `ms`. */
export function offsetAt(ms: number, timeZone: string): number {
  const parts = Object.fromEntries(
    wallClockIn(timeZone)
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

/**
 * The instant the wall clock in `timeZone` shows `minutes` after midnight of `date`. A time the clocks skip (spring
 * forward) moves on by the skipped length; a time they show twice (fall back) is its first occurrence (22 §2).
 */
export function zonedInstant(date: string, minutes: number, timeZone: string): number {
  const wall = Date.parse(date) + minutes * MINUTE_MS;
  const guess = wall - offsetAt(wall, timeZone);
  const before = offsetAt(guess - SIX_HOURS, timeZone);
  const after = offsetAt(guess + SIX_HOURS, timeZone);
  const shown = [wall - before, wall - after].filter((t) => t + offsetAt(t, timeZone) === wall);
  // Neither offset shows the time: it falls in the skipped hour, read with the offset from before the change.
  return shown.length === 0 ? wall - before : Math.min(...shown);
}
