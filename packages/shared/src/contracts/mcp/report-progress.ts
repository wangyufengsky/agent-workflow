import { z } from 'zod';
import { REPORT_PROGRESS_MAX_CHARS } from '../../constants/limits.ts';

/** `report_progress` (12 §6.8). */
export const reportProgressInputSchema = z.object({
  message: z.string().min(1).max(REPORT_PROGRESS_MAX_CHARS).describe('One short line on what you are doing now'),
});
export const reportProgressOutputSchema = z.object({ ok: z.literal(true) });
