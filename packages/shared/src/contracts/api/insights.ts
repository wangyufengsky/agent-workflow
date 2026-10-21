import { z } from 'zod';
import { INSIGHTS_MAX_DAYS } from '../../constants/limits.ts';
import {
  InsightsDimension,
  InsightsPeriod,
  insightsFailureKindSchema,
  insightsPeriodSchema,
} from '../../enums/insights.ts';
import { attemptKindSchema } from '../../enums/task.ts';
import { errorCodeSchema } from '../../errors/codes.ts';
import { taskSummarySchema } from './tasks.ts';

const DAY_MS = 86_400_000;
/** Days from `from` to `to`, both included (calendar dates, no time zone involved). */
const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;

/** `GET /insights` and `/insights/tasks` (19 §4): `from` / `to` only with `custom`. */
export const insightsQuerySchema = z
  .object({
    period: insightsPeriodSchema,
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .superRefine(({ period, from, to }, ctx) => {
    if (period !== InsightsPeriod.Custom) {
      if (from !== undefined || to !== undefined) {
        ctx.addIssue({ code: 'custom', message: 'from and to go with the custom period only', path: ['from'] });
      }
      return;
    }
    if (from === undefined || to === undefined) {
      ctx.addIssue({ code: 'custom', message: 'The custom period needs from and to', path: ['from'] });
      return;
    }
    const days = daysBetween(from, to);
    if (days < 1) ctx.addIssue({ code: 'custom', message: 'from is after to', path: ['to'] });
    if (days > INSIGHTS_MAX_DAYS) {
      ctx.addIssue({ code: 'custom', message: `At most ${INSIGHTS_MAX_DAYS} days`, path: ['to'] });
    }
  });
export type InsightsQuery = z.infer<typeof insightsQuerySchema>;

/** Usage of a set of attempts (19 §2.3); cost in USD as opencode reports it. */
export const usageTotalsSchema = z.object({
  attempts: z.number(),
  tokensInput: z.number(),
  tokensOutput: z.number(),
  cost: z.number(),
  /** Tokens of attempts that reported no cost: a free model or one without a price, which opencode cannot tell apart. */
  unpricedTokens: z.number(),
});
export type UsageTotals = z.infer<typeof usageTotalsSchema>;

/** One group of a breakdown; a null key is a group the UI names (knowledge Q&A, opencode's default model). */
export const usageGroupSchema = usageTotalsSchema.extend({ key: z.string().nullable(), name: z.string().nullable() });
export type UsageGroupDTO = z.infer<typeof usageGroupSchema>;

export const failureReasonSchema = z.object({
  kind: insightsFailureKindSchema,
  /** The attempt's error code for `attempt_error`. */
  code: errorCodeSchema.nullable(),
  count: z.number(),
});
export type FailureReasonDTO = z.infer<typeof failureReasonSchema>;

const ratio = z.number().min(0).max(1).nullable();

export const insightsSummarySchema = z.object({
  period: z.object({ period: insightsPeriodSchema, from: z.iso.date(), to: z.iso.date(), timeZone: z.string() }),
  usage: usageTotalsSchema.extend({
    groups: z.object({
      [InsightsDimension.Project]: z.array(usageGroupSchema),
      [InsightsDimension.Workflow]: z.array(usageGroupSchema),
      [InsightsDimension.Role]: z.array(usageGroupSchema),
      [InsightsDimension.Model]: z.array(usageGroupSchema),
      [InsightsDimension.Kind]: z.array(usageGroupSchema),
    }),
  }),
  /** Every day of the period, oldest first. */
  days: z.array(usageTotalsSchema.extend({ date: z.iso.date(), tasksCompleted: z.number() })),
  /** Tasks that ended in the period (19 §2.4); rates are null without a denominator. */
  quality: z.object({
    ended: z.object({ completed: z.number(), cancelled: z.number(), failed: z.number() }),
    completionRate: ratio,
    doneNodes: z.number(),
    firstPassNodes: z.number(),
    firstPassRate: ratio,
    finishedNodes: z.number(),
    retries: z.number(),
    avgRetries: z.number().nullable(),
    interruptions: z.number(),
    avgInterruptions: z.number().nullable(),
    reviewDurationMedianMs: z.number().nullable(),
    failureReasons: z.array(failureReasonSchema),
  }),
  /** Questions and permission requests created in the period, whatever they belong to (19 §2.5). */
  attention: z.object({ interruptions: z.number() }),
});
export type InsightsSummaryDTO = z.infer<typeof insightsSummarySchema>;

/** A task the period is about: it ended in the period, or used AI in it (19 §4). */
export const insightsTaskSchema = z.object({
  task: taskSummarySchema,
  /** In the period. */
  usage: usageTotalsSchema,
  roles: z.array(z.string()),
  models: z.array(z.string().nullable()),
  kinds: z.array(attemptKindSchema),
  /** Only for a task that ended in the period: it counts for quality (19 §2.4). */
  quality: z
    .object({
      endedAt: z.number(),
      doneNodes: z.number(),
      firstPassNodes: z.number(),
      retries: z.number(),
      interruptions: z.number(),
      failureReasons: z.array(failureReasonSchema),
      reviewDurationMs: z.number().nullable(),
    })
    .nullable(),
});
export type InsightsTaskDTO = z.infer<typeof insightsTaskSchema>;
