import { z } from 'zod';
import {
  INITIATIVE_ITEM_REQUIREMENT_MAX_CHARS,
  INITIATIVE_ITEMS_MAX,
  INITIATIVE_PHASE_GOAL_MAX_CHARS,
  INITIATIVE_PHASE_TITLE_MAX_CHARS,
  INITIATIVE_PHASES_MAX,
  INITIATIVE_SUMMARY_MAX_CHARS,
  INITIATIVE_TITLE_MAX_CHARS,
  REQUIREMENT_EXPECTED_MAX_CHARS,
  REQUIREMENT_TITLE_MAX_CHARS,
  REQUIREMENTS_MAX,
} from '../../constants/limits.ts';
import { NODE_KEY_PATTERN } from '../../workflow/plan-graph.ts';

const text = (max: number) => z.string().trim().min(1).max(max);
const notes = z.array(text(500)).max(20).default([]);

/** What the AI understood (34 §8.2); shown above the draft, as it does not ask the user (D133 ②). */
export const initiativeUnderstandingSchema = z.object({
  scope: text(INITIATIVE_SUMMARY_MAX_CHARS).describe('What the requirement covers, in a few sentences'),
  out_of_scope: notes.describe('What is left out, and why'),
  assumptions: notes.describe('What you assumed where the requirement left it open'),
  risks: notes.describe('What may go wrong or needs a decision'),
});
export type InitiativeUnderstanding = z.output<typeof initiativeUnderstandingSchema>;

/** One line of the coverage table: a point of the requirement and the work packages that do it. */
export const initiativeCoverageSchema = z.object({
  point: text(500).describe('One point of the requirement, in its own words'),
  items: z
    .array(z.string())
    .describe('Keys of the work packages that do it; empty when left out (say why in out_of_scope)'),
});
export type InitiativeCoverage = z.output<typeof initiativeCoverageSchema>;

/** `submit_breakdown` (34 §8.2): phases are human gates; the app checks how the parts fit (34 §8.3). */
export const submitBreakdownInputSchema = z.object({
  title: text(INITIATIVE_TITLE_MAX_CHARS).describe('A short title of the whole requirement'),
  summary: text(INITIATIVE_SUMMARY_MAX_CHARS).describe('How you split it, in two or three sentences for the user'),
  understanding: initiativeUnderstandingSchema,
  phases: z
    .array(
      z.object({
        title: text(INITIATIVE_PHASE_TITLE_MAX_CHARS),
        goal: text(INITIATIVE_PHASE_GOAL_MAX_CHARS).describe('What the phase delivers and how to tell it is done'),
      }),
    )
    .min(1)
    .max(INITIATIVE_PHASES_MAX)
    .describe('In order; each phase ends with the user merging its work, so only split where later work needs it'),
  items: z
    .array(
      z.object({
        key: z.string().regex(NODE_KEY_PATTERN).describe('Short identifier, [a-z0-9_]'),
        title: text(INITIATIVE_TITLE_MAX_CHARS),
        phase: z.number().int().min(1).describe('1-based index into phases'),
        workflow: z.string().describe('Key of one of the allowed workflows'),
        requirement: text(INITIATIVE_ITEM_REQUIREMENT_MAX_CHARS).describe(
          'The task requirement: what to do, which modules and interfaces to change and how to check it; complete on its own',
        ),
        depends_on: z
          .array(z.string())
          .default([])
          .describe('Keys of work packages of this or an earlier phase it needs'),
        acceptance: z
          .array(
            z.object({
              title: text(REQUIREMENT_TITLE_MAX_CHARS),
              expected: text(REQUIREMENT_EXPECTED_MAX_CHARS),
              command: z
                .string()
                .trim()
                .min(1)
                .optional()
                .describe("The project's test command that checks it; omit for an AI check"),
            }),
          )
          .max(REQUIREMENTS_MAX)
          .default([]),
      }),
    )
    .min(1)
    .max(INITIATIVE_ITEMS_MAX),
  coverage: z.array(initiativeCoverageSchema).min(1).describe('Every point of the requirement and who does it'),
});
export type SubmitBreakdownInput = z.output<typeof submitBreakdownInputSchema>;
export const submitBreakdownOutputSchema = z.object({ accepted: z.literal(true) });
