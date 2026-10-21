import { z } from 'zod';
import {
  DECK_MAX_SLIDES,
  DECK_TITLE_MAX_CHARS,
  SLIDE_POINT_MAX_CHARS,
  SLIDE_POINTS_MAX,
  SLIDE_TEXT_LIMITS,
} from '../../constants/limits.ts';
import { slideLayoutSchema } from '../../enums/deck.ts';

/** What the AI understood the PPT is for (23 §2.4), shown above the outline: it does not ask the user (D95). */
export const deckUnderstandingSchema = z.object({
  audience: z.string().trim().min(1).max(200).describe('Who the PPT is for'),
  duration: z.string().trim().min(1).max(100).describe('How long the talk is, e.g. "约 15 分钟"'),
  assumptions: z
    .array(z.string().trim().min(1).max(300))
    .max(10)
    .describe('What you assumed where the brief and material left it open'),
});
export type DeckUnderstanding = z.infer<typeof deckUnderstandingSchema>;

/** One outline page: its suggested layout, title and what it is to say (23 §2.4). */
export const outlineSlideSchema = z.object({
  layout: slideLayoutSchema,
  title: z.string().trim().min(1).max(SLIDE_TEXT_LIMITS.title),
  points: z.array(z.string().trim().min(1).max(SLIDE_POINT_MAX_CHARS)).max(SLIDE_POINTS_MAX),
});
export type OutlineSlide = z.infer<typeof outlineSlideSchema>;

/** `submit_outline` (23 §7.3). */
export const submitOutlineInputSchema = z.object({
  title: z.string().trim().min(1).max(DECK_TITLE_MAX_CHARS).describe('Title of the PPT'),
  understanding: deckUnderstandingSchema,
  slides: z.array(outlineSlideSchema).min(1).max(DECK_MAX_SLIDES).describe('The pages in order'),
});
export type SubmitOutlineInput = z.infer<typeof submitOutlineInputSchema>;
export const submitOutlineOutputSchema = z.object({ accepted: z.literal(true) });
