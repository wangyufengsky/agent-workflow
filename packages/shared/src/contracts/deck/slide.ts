import { z } from 'zod';
import { SLIDE_TEXT_LIMITS as L, SLIDE_NOTES_MAX_CHARS } from '../../constants/limits.ts';
import { SlideLayout } from '../../enums/deck.ts';

/** Plain text of a page; `**…**` is the only mark (emphasis, 23 §5.1). */
const text = (max: number) => z.string().trim().min(1).max(max);
const list = (item: z.ZodString, min: number, max: number) => z.array(item).min(min).max(max);

const title = text(L.title).describe('The page title: a statement, not a topic');
const column = z.object({
  heading: text(L.columnHeading),
  bullets: list(text(L.columnBullet), 1, L.columnBullets),
});

/**
 * One page's content in its layout (23 §5.1, D93). The AI submits it, the user edits it, the app renders it with the
 * PPT's theme; limits keep the text inside the canvas.
 */
export const slideContentSchema = z.discriminatedUnion('layout', [
  z.object({ layout: z.literal(SlideLayout.Cover), title, subtitle: text(L.subtitle).optional() }),
  z.object({ layout: z.literal(SlideLayout.Section), title, subtitle: text(L.subtitle).optional() }),
  z.object({ layout: z.literal(SlideLayout.Bullets), title, bullets: list(text(L.bullet), 1, L.bullets) }),
  z.object({ layout: z.literal(SlideLayout.TwoColumn), title, left: column, right: column }),
  z.object({
    layout: z.literal(SlideLayout.Cards),
    title,
    cards: z
      .array(z.object({ heading: text(L.cardHeading), body: text(L.cardBody) }))
      .min(L.cardsMin)
      .max(L.cardsMax),
  }),
  z.object({
    layout: z.literal(SlideLayout.Steps),
    title,
    steps: z
      .array(z.object({ label: text(L.stepLabel), detail: text(L.stepDetail).optional() }))
      .min(L.stepsMin)
      .max(L.stepsMax),
  }),
  z.object({
    layout: z.literal(SlideLayout.Stats),
    title,
    stats: z
      .array(z.object({ value: text(L.statValue), label: text(L.statLabel) }))
      .min(1)
      .max(L.statsMax),
  }),
  z
    .object({
      layout: z.literal(SlideLayout.Table),
      title,
      columns: list(text(L.tableHeader), L.tableColumnsMin, L.tableColumnsMax),
      rows: z
        .array(z.array(z.string().trim().max(L.tableCell)))
        .min(1)
        .max(L.tableRows),
    })
    .refine((t) => t.rows.every((row) => row.length === t.columns.length), {
      message: 'Every row has one cell per column',
      path: ['rows'],
    }),
  z
    .object({
      layout: z.literal(SlideLayout.Code),
      title,
      language: text(L.codeLanguage).describe('Language of the code, e.g. ts, java, sql'),
      code: z.string().min(1),
      caption: text(L.caption).optional(),
    })
    .refine((c) => c.code.split('\n').length <= L.codeLines, {
      message: `At most ${L.codeLines} lines`,
      path: ['code'],
    })
    .refine((c) => c.code.split('\n').every((line) => line.length <= L.codeLineChars), {
      message: `Lines of at most ${L.codeLineChars} characters`,
      path: ['code'],
    }),
  z.object({ layout: z.literal(SlideLayout.Quote), quote: text(L.quote), attribution: text(L.attribution).optional() }),
]);
export type SlideContent = z.infer<typeof slideContentSchema>;
/** One layout's content. */
export type SlideContentOf<K extends SlideLayout> = Extract<SlideContent, { layout: K }>;

export const slideNotesSchema = z.string().trim().max(SLIDE_NOTES_MAX_CHARS);

/** A page's title for lists and the outline: the quote of a quote page. */
export const slideHeadline = (content: SlideContent): string =>
  content.layout === SlideLayout.Quote ? content.quote : content.title;
