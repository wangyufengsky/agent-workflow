import { z } from 'zod';
import { REPORT_PROGRESS_MAX_CHARS, RESULT_SUMMARY_MAX_CHARS } from '../../constants/limits.ts';
import { taskCodeReviewInputSchema } from '../api/task-code-review.ts';

/** `report_progress` (12 §6.8). */
export const reportProgressInputSchema = z.object({
  code_review: taskCodeReviewInputSchema
    .optional()
    .describe('Review steps: all confirmed findings so far and their Git scope'),
  proposal: z
    .string()
    .trim()
    .min(1)
    .max(RESULT_SUMMARY_MAX_CHARS)
    .optional()
    .describe('Design proposal step: current user-facing Markdown draft, including previous sections'),
  message: z.string().min(1).max(REPORT_PROGRESS_MAX_CHARS).describe('One short line on what you are doing now'),
});
export const reportProgressOutputSchema = z.object({ ok: z.literal(true) });
