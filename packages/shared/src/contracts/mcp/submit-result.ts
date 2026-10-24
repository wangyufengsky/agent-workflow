import { z } from 'zod';
import { REQUIREMENT_NOTE_MAX_CHARS, RESULT_SUMMARY_MAX_CHARS } from '../../constants/limits.ts';
import { RequirementConclusion } from '../../enums/requirement.ts';

/** `submit_result` (12 §6.5). */
export const submitResultInputSchema = z.object({
  summary: z.string().min(1).max(RESULT_SUMMARY_MAX_CHARS).describe('What you did, in Markdown'),
  changes: z
    .array(z.object({ path: z.string().min(1), description: z.string().min(1) }))
    .optional()
    .describe('Files you changed and why'),
  assumptions: z.array(z.string().min(1)).optional().describe('Assumptions you made instead of asking the user'),
  notes: z.string().optional().describe('Anything later steps or the user should know'),
  self_check: z
    .object({ tests_run: z.boolean(), tests_passed: z.boolean().optional(), details: z.string().optional() })
    .optional()
    .describe('Whether you ran the tests yourself and how it went'),
  requirement_results: z
    .array(
      z.object({
        item_id: z.string().min(1),
        conclusion: z.enum([RequirementConclusion.Pass, RequirementConclusion.Fail, RequirementConclusion.Unverified]),
        note: z.string().min(1).max(REQUIREMENT_NOTE_MAX_CHARS),
      }),
    )
    .optional()
    .describe(
      'Only in the step 核验验收清单: your conclusion on each ai_review item of the checklist, with what you based it on',
    ),
});
export type SubmitResultInput = z.infer<typeof submitResultInputSchema>;

export const ResultNext = {
  Verifying: 'verifying',
  AwaitingAcceptance: 'awaiting_acceptance',
  Done: 'done',
} as const;
export type ResultNext = (typeof ResultNext)[keyof typeof ResultNext];

export const submitResultOutputSchema = z.object({ accepted: z.literal(true), next: z.enum(ResultNext) });
