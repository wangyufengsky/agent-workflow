import { z } from 'zod';

export const submissionGuideInputSchema = z.object({}).strict();
export const designSourceIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
  relPath: z.string(),
  lineStart: z.number(),
  lineEnd: z.number(),
  fileLineCount: z.number(),
});
export type DesignSourceIssue = z.infer<typeof designSourceIssueSchema>;

export const submissionRejectionSchema = z.object({
  tool: z.string(),
  code: z.string(),
  message: z.string(),
  remove: z.array(z.string()),
  fields: z.array(z.string()),
  sourceIssues: z.array(designSourceIssueSchema).optional(),
});
export const submissionGuideOutputSchema = z.object({
  skill: z.string(),
  tool: z.string(),
  required: z.array(z.string()),
  allowed: z.array(z.string()),
  omit: z.array(z.string()),
  parameters: z.record(z.string(), z.string()),
  example: z.record(z.string(), z.unknown()),
  instructions: z.string(),
  remove: z.array(z.string()),
  lastRejection: submissionRejectionSchema.optional(),
});
export type SubmissionGuide = z.infer<typeof submissionGuideOutputSchema>;
export type SubmissionRejection = z.infer<typeof submissionRejectionSchema>;
