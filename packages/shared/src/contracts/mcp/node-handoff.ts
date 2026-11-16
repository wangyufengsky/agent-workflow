import { z } from 'zod';
import { NODE_HANDOFF_ITEM_MAX_CHARS, NODE_HANDOFF_ITEMS_MAX } from '../../constants/limits.ts';

const short = z.string().trim().min(1).max(NODE_HANDOFF_ITEM_MAX_CHARS);

export const nodeHandoffSchema = z
  .object({
    facts: z
      .array(z.object({ text: short, evidence: short }))
      .max(NODE_HANDOFF_ITEMS_MAX)
      .default([])
      .describe('Confirmed facts with a file/location, check, or user decision as evidence'),
    decisions: z
      .array(short)
      .max(NODE_HANDOFF_ITEMS_MAX)
      .default([])
      .describe('Decisions and constraints to carry forward'),
    openQuestions: z
      .array(short)
      .max(NODE_HANDOFF_ITEMS_MAX)
      .default([])
      .describe('Unresolved points for dependent steps'),
  })
  .refine(({ facts, decisions, openQuestions }) => facts.length + decisions.length + openQuestions.length > 0, {
    message: 'Provide a fact, decision or open question',
  });

export const nodeHandoffOutputSchema = z.object({
  content: nodeHandoffSchema,
  attemptId: z.string(),
  commitSha: z.string().nullable(),
});
