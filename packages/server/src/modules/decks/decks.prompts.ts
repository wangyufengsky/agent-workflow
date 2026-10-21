import { DECK_AUTO_SLIDES_MAX, DECK_AUTO_SLIDES_MIN, SLIDE_TEXT_LIMITS as L, SlideLayout } from '@aw/shared';
import type { Slide } from './decks.repo.ts';

/** Fields of each layout as the writer reads them; the limits are the schema's (23 §5.1), written out once here. */
const LAYOUT_FIELDS: Record<SlideLayout, string> = {
  [SlideLayout.Cover]: `title page: title (≤${L.title}), subtitle? (≤${L.subtitle})`,
  [SlideLayout.Section]: `section divider: title (≤${L.title}), subtitle? (≤${L.subtitle})`,
  [SlideLayout.Bullets]: `title, bullets: 1–${L.bullets} items (≤${L.bullet} each)`,
  [SlideLayout.TwoColumn]: `comparison: title, left and right: { heading (≤${L.columnHeading}), bullets: 1–${L.columnBullets} items (≤${L.columnBullet} each) }`,
  [SlideLayout.Cards]: `title, cards: ${L.cardsMin}–${L.cardsMax} × { heading (≤${L.cardHeading}), body (≤${L.cardBody}) }`,
  [SlideLayout.Steps]: `a process from left to right: title, steps: ${L.stepsMin}–${L.stepsMax} × { label (≤${L.stepLabel}), detail? (≤${L.stepDetail}) }`,
  [SlideLayout.Stats]: `key figures: title, stats: 1–${L.statsMax} × { value (≤${L.statValue}, e.g. "200 ms"), label (≤${L.statLabel}) }`,
  [SlideLayout.Table]: `title, columns: ${L.tableColumnsMin}–${L.tableColumnsMax} headers (≤${L.tableHeader}), rows: 1–${L.tableRows} rows with one cell (≤${L.tableCell}) per column`,
  [SlideLayout.Code]: `a short code excerpt: title, language, code (≤${L.codeLines} lines of ≤${L.codeLineChars} characters), caption? (≤${L.caption})`,
  [SlideLayout.Quote]: `one conclusion or quote: quote (≤${L.quote}), attribution? (≤${L.attribution}); no title`,
};

/** The layout catalogue in the writer's messages. */
export const describeLayouts = (): string =>
  Object.entries(LAYOUT_FIELDS)
    .map(([layout, fields]) => `- \`${layout}\`: ${fields}`)
    .join('\n');

export const describeSlideCount = (target: number | null): string =>
  target === null
    ? `decide yourself, between ${DECK_AUTO_SLIDES_MIN} and ${DECK_AUTO_SLIDES_MAX}`
    : `exactly ${target}`;

/** The outline as JSON, for a rewrite: what the user sees and may have edited. */
export const describeOutline = (slides: readonly Slide[]): string =>
  JSON.stringify(
    slides.map((s) => ({ page: s.seq, layout: s.layout, title: s.title, points: s.points })),
    null,
    2,
  );

/** Pages to make: number, suggested layout, title and points. */
export const describePagesToMake = (slides: readonly Slide[]): string =>
  slides
    .map((s) => [`### Page ${s.seq} · \`${s.layout}\` · ${s.title}`, ...s.points.map((p) => `- ${p}`)].join('\n'))
    .join('\n\n');

/** Pages to revise with their current content and notes. */
export const describePagesToRevise = (slides: readonly Slide[]): string =>
  slides
    .map((s) =>
      [`### Page ${s.seq}`, '```json', JSON.stringify({ content: s.content, notes: s.notes }, null, 2), '```'].join(
        '\n',
      ),
    )
    .join('\n\n');
