import { z } from 'zod';
import { REQUIREMENT_MAX_CHARS, SCHEDULE_EVERY_HOURS } from '../../constants/limits.ts';
import {
  ScheduleFrequencyKind,
  scheduleRunOutcomeSchema,
  scheduleRunTriggerSchema,
  scheduleStatusSchema,
} from '../../enums/schedule.ts';
import { errorInfoSchema } from '../../errors/codes.ts';
import { taskSummarySchema } from './tasks.ts';

/** 24-hour `HH:MM`. */
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time is HH:MM');

/** `ScheduleFrequency` (22 §2, D90): one of three presets in the system time zone. */
export const scheduleFrequencySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal(ScheduleFrequencyKind.Daily), time: timeSchema }),
  z.object({
    kind: z.literal(ScheduleFrequencyKind.Weekly),
    /** 0 = Sunday, as `Date.getDay()`. */
    weekdays: z
      .array(z.int().min(0).max(6))
      .min(1)
      .refine((days) => new Set(days).size === days.length, 'weekdays must be unique'),
    time: timeSchema,
  }),
  z.object({
    kind: z.literal(ScheduleFrequencyKind.Hourly),
    everyHours: z.literal(SCHEDULE_EVERY_HOURS),
    /** The first run of the day; the others follow every `everyHours`. */
    time: timeSchema,
  }),
]);
export type ScheduleFrequency = z.infer<typeof scheduleFrequencySchema>;

const requirementSchema = z.string().trim().min(1).max(REQUIREMENT_MAX_CHARS);

/** `POST /schedules` (22 §9). */
export const createScheduleRequestSchema = z.object({
  projectId: z.string(),
  /** A fixed workflow; each run uses its latest version. */
  workflowKey: z.string(),
  /** Each run's task requirement. */
  requirement: requirementSchema,
  frequency: scheduleFrequencySchema,
  /** Omitted: the project's default branch at each run. */
  baseBranch: z.string().min(1).optional(),
});
export type CreateScheduleRequest = z.infer<typeof createScheduleRequestSchema>;

/** `PATCH /schedules/:id`: the project stays; `baseBranch: null` goes back to the default branch. */
export const updateScheduleRequestSchema = z.object({
  id: z.string(),
  workflowKey: z.string().optional(),
  requirement: requirementSchema.optional(),
  frequency: scheduleFrequencySchema.optional(),
  baseBranch: z.string().min(1).nullable().optional(),
});
export type UpdateScheduleRequest = z.infer<typeof updateScheduleRequestSchema>;

export const listSchedulesQuerySchema = z.object({ projectId: z.string().optional() });
export type ListSchedulesQuery = z.infer<typeof listSchedulesQuerySchema>;

/** `ScheduleRunDTO`: one time the schedule came due or was run by hand (22 §4). */
export const scheduleRunSchema = z.object({
  id: z.string(),
  trigger: scheduleRunTriggerSchema,
  outcome: scheduleRunOutcomeSchema,
  /** The scheduled time the run stands for; when it was clicked for a manual run. */
  dueAt: z.number(),
  /** Earlier scheduled times folded into this run. */
  missed: z.number(),
  /** When it was handled. */
  createdAt: z.number(),
  /** The task a `started` run made. */
  task: taskSummarySchema.nullable(),
  /** Why a `failed` run made no task. */
  error: errorInfoSchema.nullable(),
});
export type ScheduleRunDTO = z.infer<typeof scheduleRunSchema>;

/** `ScheduleDTO` (22 §9). */
export const scheduleSchema = z.object({
  id: z.string(),
  /** The requirement's first line. */
  title: z.string(),
  requirement: z.string(),
  project: z.object({ id: z.string(), name: z.string() }),
  /** `name` is null once the workflow was deleted. */
  workflow: z.object({ key: z.string(), name: z.string().nullable() }),
  baseBranch: z.string().nullable(),
  frequency: scheduleFrequencySchema,
  status: scheduleStatusSchema,
  /** Null while paused. */
  nextRunAt: z.number().nullable(),
  /** The task of the latest started run while it has not ended; the next run waits for it (22 §4). */
  activeTask: taskSummarySchema.nullable(),
  lastRun: scheduleRunSchema.nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ScheduleDTO = z.infer<typeof scheduleSchema>;

export const scheduleDetailSchema = scheduleSchema.extend({
  /** The latest `SCHEDULE_RUNS_SHOWN` runs, newest first. */
  runs: z.array(scheduleRunSchema),
});
export type ScheduleDetailDTO = z.infer<typeof scheduleDetailSchema>;
