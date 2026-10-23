import { z } from 'zod';
import {
  REQUIREMENT_EXPECTED_MAX_CHARS,
  REQUIREMENT_NOTE_MAX_CHARS,
  REQUIREMENT_TITLE_MAX_CHARS,
  REQUIREMENTS_MAX,
} from '../../constants/limits.ts';
import {
  RequirementVerification,
  requirementConclusionSchema,
  requirementDisplayStatusSchema,
  requirementResultSourceSchema,
} from '../../enums/requirement.ts';

/** How one item is verified (31 §2.2); a command is the user's, never taken from a model's answer. */
export const requirementVerificationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal(RequirementVerification.Command), command: z.string().trim().min(1) }),
  z.object({ kind: z.literal(RequirementVerification.AiReview) }),
  z.object({ kind: z.literal(RequirementVerification.Manual) }),
]);
export type RequirementVerificationSpec = z.infer<typeof requirementVerificationSchema>;

/** One item as stored in a checklist version (10 §6.2); its id stays the same across versions. */
export const requirementItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  expected: z.string(),
  required: z.boolean(),
  verification: requirementVerificationSchema,
});
export type RequirementItem = z.infer<typeof requirementItemSchema>;

/** One item as the user or the assistant writes it: `id` keeps an item of the current version, else it is new. */
export const requirementItemInputSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1).max(REQUIREMENT_TITLE_MAX_CHARS),
  expected: z.string().trim().min(1).max(REQUIREMENT_EXPECTED_MAX_CHARS),
  required: z.boolean().default(true),
  verification: requirementVerificationSchema.default({ kind: RequirementVerification.AiReview }),
});
export type RequirementItemInput = z.input<typeof requirementItemInputSchema>;

export const requirementItemsInputSchema = z.array(requirementItemInputSchema).min(1).max(REQUIREMENTS_MAX);

/** A conclusion on one item (10 §6.2), recorded with the checklist version and the commit it was about. */
export const requirementResultSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  revisionId: z.string(),
  source: requirementResultSourceSchema,
  conclusion: requirementConclusionSchema,
  note: z.string().max(REQUIREMENT_NOTE_MAX_CHARS),
  /** A command's output, cut to its end; null for AI and user conclusions. */
  output: z.string().nullable(),
  commitSha: z.string(),
  createdAt: z.number(),
});
export type RequirementResultDTO = z.infer<typeof requirementResultSchema>;

export const requirementRevisionSummarySchema = z.object({ id: z.string(), seq: z.number(), createdAt: z.number() });

/** `GET /tasks/:id/requirements` (11 §14.2): the current version with each item's state; empty without a checklist. */
export const taskRequirementsSchema = z.object({
  revision: requirementRevisionSummarySchema.nullable(),
  items: z.array(
    requirementItemSchema.extend({
      status: requirementDisplayStatusSchema,
      /** The conclusion the status comes from (the item's latest), if any. */
      latest: requirementResultSchema.nullable(),
    }),
  ),
  /** Earlier versions, newest first. */
  history: z.array(requirementRevisionSummarySchema),
});
export type TaskRequirementsDTO = z.infer<typeof taskRequirementsSchema>;

/** `PUT /tasks/:id/requirements`: the whole checklist as it should be; saved as a new version. */
export const replaceRequirementsSchema = z.object({ id: z.string(), items: requirementItemsInputSchema });
