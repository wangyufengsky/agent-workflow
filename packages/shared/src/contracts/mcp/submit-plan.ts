import { z } from 'zod';
import { NODE_INSTRUCTIONS_MAX_CHARS } from '../../constants/limits.ts';
import { NODE_KEY_PATTERN, pageCheckPagesSchema } from '../../workflow/plan-graph.ts';

export const PLAN_SUMMARY_MAX_CHARS = 2000;
export const NODE_TITLE_MAX_CHARS = 60;

/** `submit_plan` (12 §6.4). Snake case: the model writes it. */
export const submitPlanInputSchema = z.object({
  summary: z.string().min(1).max(PLAN_SUMMARY_MAX_CHARS).describe('What the plan does and why, for the user'),
  assumptions: z.array(z.string().min(1)).optional().describe('Decisions you made without asking the user'),
  nodes: z
    .array(
      z.object({
        key: z.string().regex(NODE_KEY_PATTERN).describe('Unique step id, [a-z0-9_]{1,40}'),
        title: z.string().min(1).max(NODE_TITLE_MAX_CHARS).describe('A few words, in the language of the requirement'),
        role: z.string().min(1).describe('Role key from the allowed roles of get_task_context'),
        // Over-long instructions are a plan problem (INSTRUCTIONS_TOO_LONG with a hint), not a schema error.
        instructions: z
          .string()
          .min(1)
          .describe(`What to do, where and how to verify it (≤ ${NODE_INSTRUCTIONS_MAX_CHARS} chars)`),
        depends_on: z.array(z.string()).optional().describe('Keys of steps whose results this step needs'),
        acceptance: z
          .object({
            command: z
              .string()
              .min(1)
              .optional()
              .describe('Shell command that must exit 0; $PROJECT_CHECK runs the project check'),
            pages: pageCheckPagesSchema
              .optional()
              .describe(
                "Paths of the task's page preview to check after the step (e.g. ['/orders']), at desktop and mobile size; ignored when the project has no preview",
              ),
            ai_review: z.boolean().optional().describe('Have another AI session review the step'),
            manual: z.boolean().optional().describe('Ask the user to accept the step'),
          })
          .optional()
          .describe("Omit to use the workflow's default acceptance"),
      }),
    )
    .describe('The steps of the plan'),
});
export type SubmitPlanInput = z.infer<typeof submitPlanInputSchema>;
export const submitPlanOutputSchema = z.object({ version: z.number(), accepted: z.literal(true) });
