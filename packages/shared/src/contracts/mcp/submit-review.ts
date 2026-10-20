import { z } from 'zod';

export const ReviewVerdict = {
  Pass: 'pass',
  Fail: 'fail',
} as const;
export type ReviewVerdict = (typeof ReviewVerdict)[keyof typeof ReviewVerdict];

export const IssueSeverity = {
  Blocker: 'blocker',
  Major: 'major',
  Minor: 'minor',
} as const;
export type IssueSeverity = (typeof IssueSeverity)[keyof typeof IssueSeverity];

export const reviewIssueSchema = z.object({
  severity: z.enum(IssueSeverity),
  path: z.string().min(1).optional(),
  line: z.number().int().min(1).optional(),
  description: z.string().min(1),
});
export type ReviewIssue = z.infer<typeof reviewIssueSchema>;

/** `submit_review` (12 §6.6). */
export const submitReviewInputSchema = z.object({
  verdict: z.enum(ReviewVerdict).describe('pass, or fail with at least one blocker or major issue'),
  summary: z.string().min(1).describe('The review in a few sentences, in the language of the requirement'),
  issues: z.array(reviewIssueSchema).optional().describe('Real problems only, each with a location'),
});
export type SubmitReviewInput = z.infer<typeof submitReviewInputSchema>;
export const submitReviewOutputSchema = z.object({ accepted: z.literal(true) });
