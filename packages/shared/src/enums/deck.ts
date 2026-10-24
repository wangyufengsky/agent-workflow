import { z } from 'zod';

/** A PPT's status, derived from its pages and its latest AI work (23 §4.3); not stored. */
export const DeckStatus = {
  Outlining: 'outlining',
  OutlineReady: 'outline_ready',
  /** No outline came out of the AI work. */
  Failed: 'failed',
  Generating: 'generating',
  /** The outline is confirmed and some pages are still to be made. */
  Incomplete: 'incomplete',
  Ready: 'ready',
} as const;
export type DeckStatus = (typeof DeckStatus)[keyof typeof DeckStatus];
export const deckStatusSchema = z.enum(DeckStatus);

/** What one AI work on a PPT does (23 §3 `deck_runs`): told by its attempt's kind. */
export const DeckRunKind = {
  Outline: 'outline',
  Slides: 'slides',
} as const;
export type DeckRunKind = (typeof DeckRunKind)[keyof typeof DeckRunKind];
export const deckRunKindSchema = z.enum(DeckRunKind);

/** Material snapshotted into a PPT when it is created (23 §2.3). */
export const DeckMaterialKind = {
  Text: 'text',
  File: 'file',
  Task: 'task',
  Knowledge: 'knowledge',
  /** A web page read once through the website rules (29 §2.8); its text is kept, never re-read. */
  Web: 'web',
} as const;
export type DeckMaterialKind = (typeof DeckMaterialKind)[keyof typeof DeckMaterialKind];
export const deckMaterialKindSchema = z.enum(DeckMaterialKind);

/** The built-in layouts a page is written in (23 §5.1, D93). */
export const SlideLayout = {
  Cover: 'cover',
  Section: 'section',
  Bullets: 'bullets',
  TwoColumn: 'two_column',
  Cards: 'cards',
  Steps: 'steps',
  Stats: 'stats',
  Table: 'table',
  Code: 'code',
  Quote: 'quote',
} as const;
export type SlideLayout = (typeof SlideLayout)[keyof typeof SlideLayout];
export const SLIDE_LAYOUTS = Object.values(SlideLayout);
export const slideLayoutSchema = z.enum(SlideLayout);
