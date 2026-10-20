import { z } from 'zod';

export const QUESTION_MAX_CHARS = 1000;

/** `ask_user` (12 §6.7). */
export const askUserInputSchema = z.object({
  question: z.string().min(1).max(QUESTION_MAX_CHARS).describe('The question, in the language of the requirement'),
  options: z.array(z.string().min(1)).min(2).max(6).optional().describe('2–6 choices; the user may also answer freely'),
  blocking: z.boolean().describe('true when you cannot continue without the answer'),
  default_assumption: z.string().min(1).optional().describe('What you will assume if the user is not asked'),
});
export type AskUserInput = z.infer<typeof askUserInputSchema>;

export const AskUserStatus = {
  /** Not asked: continue with `proceed_with`. */
  Assumed: 'assumed',
  /** Asked: follow `instruction`. */
  Queued: 'queued',
} as const;
export type AskUserStatus = (typeof AskUserStatus)[keyof typeof AskUserStatus];

export const askUserOutputSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal(AskUserStatus.Assumed), proceed_with: z.string() }),
  z.object({ status: z.literal(AskUserStatus.Queued), instruction: z.string() }),
]);
export type AskUserOutput = z.infer<typeof askUserOutputSchema>;
