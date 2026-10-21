import type { ScheduleFrequency } from '../contracts/api/schedules.ts';
import { ScheduleFrequencyKind } from '../enums/schedule.ts';

const MINUTES_PER_DAY = 1440;

/** Minutes after midnight of an `HH:MM` the frequency schema accepted. */
export function minutesOfTime(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  if (hours === undefined || minutes === undefined) throw new Error(`Not an HH:MM time: ${time}`);
  return hours * 60 + minutes;
}

/** `HH:MM` of minutes after midnight. */
export function timeOfMinutes(minutes: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** The times of day a schedule runs on the days it runs, in minutes after midnight, earliest first (22 §2). */
export function scheduleTimesOfDay(frequency: ScheduleFrequency): number[] {
  const start = minutesOfTime(frequency.time);
  if (frequency.kind !== ScheduleFrequencyKind.Hourly) return [start];
  const step = frequency.everyHours * 60;
  return Array.from({ length: 24 / frequency.everyHours }, (_, i) => (start + i * step) % MINUTES_PER_DAY).sort(
    (a, b) => a - b,
  );
}

/** Whether a schedule runs on a day of the week (0 = Sunday). */
export function scheduleRunsOn(frequency: ScheduleFrequency, weekday: number): boolean {
  return frequency.kind !== ScheduleFrequencyKind.Weekly || frequency.weekdays.includes(weekday);
}
