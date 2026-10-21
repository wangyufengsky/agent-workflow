import { z } from 'zod';

/** A schedule runs when active; paused by the user, or by itself when a run could not start a task (22 §3). */
export const ScheduleStatus = {
  Active: 'active',
  Paused: 'paused',
} as const;
export type ScheduleStatus = (typeof ScheduleStatus)[keyof typeof ScheduleStatus];
export const scheduleStatusSchema = z.enum(ScheduleStatus);

/** The preset frequencies (22 §2, D90); no cron expressions. */
export const ScheduleFrequencyKind = {
  Daily: 'daily',
  Weekly: 'weekly',
  Hourly: 'hourly',
} as const;
export type ScheduleFrequencyKind = (typeof ScheduleFrequencyKind)[keyof typeof ScheduleFrequencyKind];

/** Why a run happened (22 §4). */
export const ScheduleRunTrigger = {
  OnTime: 'on_time',
  /** Handled well after its time (the app was closed or the computer slept), standing for the times missed. */
  CatchUp: 'catch_up',
  /** 「立即运行一次」. */
  Manual: 'manual',
} as const;
export type ScheduleRunTrigger = (typeof ScheduleRunTrigger)[keyof typeof ScheduleRunTrigger];
export const scheduleRunTriggerSchema = z.enum(ScheduleRunTrigger);

/** What a run did (22 §4–§5). */
export const ScheduleRunOutcome = {
  /** Started a task. */
  Started: 'started',
  /** The previous run's task had not ended. */
  Skipped: 'skipped',
  /** No task could be started; the schedule paused itself. */
  Failed: 'failed',
} as const;
export type ScheduleRunOutcome = (typeof ScheduleRunOutcome)[keyof typeof ScheduleRunOutcome];
export const scheduleRunOutcomeSchema = z.enum(ScheduleRunOutcome);
