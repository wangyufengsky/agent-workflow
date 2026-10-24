import { z } from 'zod';
import {
  DECK_BRIEF_MAX_CHARS,
  DECK_INSTRUCTION_MAX_CHARS,
  DECK_MATERIALS_MAX,
  DECK_MATERIALS_MAX_CHARS,
  DECK_MAX_SLIDES,
  DECK_TITLE_MAX_CHARS,
  LIST_PAGE_DEFAULT,
  LIST_PAGE_MAX,
} from '../../constants/limits.ts';
import {
  DeckMaterialKind,
  deckMaterialKindSchema,
  deckRunKindSchema,
  deckStatusSchema,
  slideLayoutSchema,
} from '../../enums/deck.ts';
import { themeIdSchema } from '../../enums/ui.ts';
import { slideContentSchema, slideNotesSchema } from '../deck/slide.ts';
import { deckUnderstandingSchema, outlineSlideSchema } from '../mcp/submit-outline.ts';
import { attemptSummarySchema } from './attempts.ts';
import { readWebsiteRequestSchema } from './browser.ts';
import { modelChoiceSchema } from './knowledge.ts';

const projectRef = z.object({ id: z.string(), name: z.string() });

/** One page (23 §3 `deck_slides`): its outline (title and points) and, once made, its content. */
export const deckSlideSchema = z.object({
  id: z.string(),
  seq: z.number(),
  layout: slideLayoutSchema,
  title: z.string(),
  points: z.array(z.string()),
  /** Null until the page is made. */
  content: slideContentSchema.nullable(),
  notes: z.string(),
  /** The AI changed the page and what it replaced can be restored (D95 ③). */
  hasPrevious: z.boolean(),
  updatedAt: z.number(),
});
export type DeckSlideDTO = z.infer<typeof deckSlideSchema>;

/** One AI work on the PPT (23 §3 `deck_runs`); its status is its attempt's. */
export const deckRunSchema = z.object({
  id: z.string(),
  kind: deckRunKindSchema,
  /** Pages it makes or revises (slide ids); empty for an outline. */
  targets: z.array(z.string()),
  /** Target pages submitted so far. */
  done: z.array(z.string()),
  instruction: z.string().nullable(),
  model: z.string().nullable(),
  attempt: attemptSummarySchema,
  /** A permission request of the writer waits in「需要你处理」. */
  awaitingInput: z.boolean(),
  createdAt: z.number(),
});
export type DeckRunDTO = z.infer<typeof deckRunSchema>;

export const deckMaterialSchema = z.object({
  id: z.string(),
  kind: deckMaterialKindSchema,
  title: z.string(),
  /** The task or knowledge conversation it was taken from. */
  refId: z.string().nullable(),
  chars: z.number(),
});
export type DeckMaterialDTO = z.infer<typeof deckMaterialSchema>;

export const deckSchema = z.object({
  id: z.string(),
  title: z.string(),
  brief: z.string(),
  theme: themeIdSchema,
  status: deckStatusSchema,
  slideCountTarget: z.number().nullable(),
  project: projectRef.nullable(),
  materials: z.array(deckMaterialSchema),
  understanding: deckUnderstandingSchema.nullable(),
  outlineConfirmed: z.boolean(),
  slides: z.array(deckSlideSchema),
  /** Oldest first; the last one is the latest. */
  runs: z.array(deckRunSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type DeckDTO = z.infer<typeof deckSchema>;

export const deckSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  theme: themeIdSchema,
  status: deckStatusSchema,
  project: projectRef.nullable(),
  slideCount: z.number(),
  madeCount: z.number(),
  /** The first page's content, for the thumbnail. */
  cover: slideContentSchema.nullable(),
  updatedAt: z.number(),
});
export type DeckSummaryDTO = z.infer<typeof deckSummarySchema>;

/** Opaque to clients: where the previous page ended (`<updatedAt>.<id>` of its last PPT). */
export const deckCursorSchema = z.string().regex(/^\d+\.[\w-]+$/);

export const listDecksQuerySchema = z.object({
  projectId: z.string().optional(),
  /** Matches titles. */
  query: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(LIST_PAGE_MAX).default(LIST_PAGE_DEFAULT),
  cursor: deckCursorSchema.optional(),
});
export type ListDecksQuery = z.infer<typeof listDecksQuerySchema>;

const materialText = z.string().min(1).max(DECK_MATERIALS_MAX_CHARS);

/** Material given when creating a PPT (23 §2.3); tasks, conversations and web pages are snapshotted by the backend. */
export const deckMaterialInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal(DeckMaterialKind.Text), content: materialText }),
  z.object({ kind: z.literal(DeckMaterialKind.File), title: z.string().trim().min(1).max(200), content: materialText }),
  z.object({ kind: z.literal(DeckMaterialKind.Task), taskId: z.string() }),
  z.object({ kind: z.literal(DeckMaterialKind.Knowledge), conversationId: z.string() }),
  z.object({ kind: z.literal(DeckMaterialKind.Web), url: readWebsiteRequestSchema.shape.url }),
]);
export type DeckMaterialInput = z.infer<typeof deckMaterialInputSchema>;

const instruction = z.string().trim().min(1).max(DECK_INSTRUCTION_MAX_CHARS);

export const createDeckRequestSchema = z.object({
  brief: z.string().trim().min(1).max(DECK_BRIEF_MAX_CHARS),
  /** The project whose code the AI may read; taken from a task or conversation material when left out. */
  projectId: z.string().optional(),
  materials: z.array(deckMaterialInputSchema).max(DECK_MATERIALS_MAX).default([]),
  /** Left out: the AI decides. */
  slideCount: z.number().int().min(1).max(DECK_MAX_SLIDES).optional(),
  /** Left out: the app's current theme. */
  theme: themeIdSchema.optional(),
  model: modelChoiceSchema,
});
export type CreateDeckRequest = z.infer<typeof createDeckRequestSchema>;

export const updateDeckRequestSchema = z.object({
  id: z.string(),
  title: z.string().trim().min(1).max(DECK_TITLE_MAX_CHARS).optional(),
  theme: themeIdSchema.optional(),
});

/** Without an instruction the outline is written again from the brief (after a failed outline). */
export const reviseOutlineRequestSchema = z.object({
  id: z.string(),
  instruction: instruction.optional(),
  model: modelChoiceSchema,
});

/** The outline as the user edited it: pages with an id are kept, the others are new. */
export const updateOutlineRequestSchema = z.object({
  id: z.string(),
  slides: z
    .array(outlineSlideSchema.extend({ id: z.string().optional() }))
    .min(1)
    .max(DECK_MAX_SLIDES),
});
export type UpdateOutlineRequest = z.infer<typeof updateOutlineRequestSchema>;

export const generateDeckRequestSchema = z.object({ id: z.string(), model: modelChoiceSchema });

export const reviseSlidesRequestSchema = z.object({
  id: z.string(),
  slideIds: z.array(z.string()).min(1).max(DECK_MAX_SLIDES),
  instruction,
  model: modelChoiceSchema,
});

export const updateSlideRequestSchema = z.object({
  id: z.string(),
  slideId: z.string(),
  content: slideContentSchema,
  notes: slideNotesSchema,
});

export const insertSlideRequestSchema = outlineSlideSchema.extend({
  id: z.string(),
  /** The new page goes after this one; left out, it becomes the first. */
  afterSlideId: z.string().optional(),
  model: modelChoiceSchema,
});

export const moveSlideRequestSchema = z.object({
  id: z.string(),
  slideId: z.string(),
  toSeq: z.number().int().min(1).max(DECK_MAX_SLIDES),
});

export const deckSlideRefSchema = z.object({ id: z.string(), slideId: z.string() });
