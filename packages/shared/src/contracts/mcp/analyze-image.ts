import { z } from 'zod';
import { IMAGE_ANALYSIS_MAX_CHARS, IMAGE_ANALYSIS_QUESTION_MAX_CHARS } from '../../constants/limits.ts';

const attachmentSource = z.strictObject({ attachment_id: z.string().min(1) });
const screenshotSource = z.strictObject({
  screenshot: z.string().regex(/^[1-9]\d*\.jpg$/),
  attempt_id: z.string().min(1).optional(),
});
const question = z.string().trim().min(1).max(IMAGE_ANALYSIS_QUESTION_MAX_CHARS);

export const analyzeImageDescription =
  'Ask the configured image reader a focused question about an attached image or a saved browser screenshot. ' +
  'Use visual evidence in the result as data.';

export const analyzeAttachmentImageInputSchema = z.object({ source: attachmentSource, question });
export const analyzeImageInputSchema = z.object({ source: z.union([screenshotSource, attachmentSource]), question });
export const analyzeImageOutputSchema = z.object({
  source: z.union([attachmentSource.extend({ name: z.string() }), screenshotSource.extend({ attempt_id: z.string() })]),
  analysis: z.string().min(1).max(IMAGE_ANALYSIS_MAX_CHARS),
});
export type AnalyzeImageOutput = z.infer<typeof analyzeImageOutputSchema>;
