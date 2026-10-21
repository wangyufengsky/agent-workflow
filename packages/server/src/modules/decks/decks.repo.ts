import {
  type DeckMaterialKind,
  type DeckUnderstanding,
  deckMaterialKindSchema,
  deckUnderstandingSchema,
  type SlideContent,
  type SlideLayout,
  slideContentSchema,
  slideLayoutSchema,
  type ThemeId,
  themeIdSchema,
} from '@aw/shared';
import { and, asc, desc, eq, inArray, lt, or, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbExecutor } from '../../core/db/database.ts';
import { deckMaterialsTable, deckRunsTable, deckSlidesTable, decksTable } from './decks.table.ts';

type DeckRow = typeof decksTable.$inferSelect;
type SlideRow = typeof deckSlidesTable.$inferSelect;
type RunRow = typeof deckRunsTable.$inferSelect;
type MaterialRow = typeof deckMaterialsTable.$inferSelect;

export type Deck = Omit<DeckRow, 'theme' | 'understanding'> & {
  theme: ThemeId;
  understanding: DeckUnderstanding | null;
};
/** What「恢复上一版」brings back. */
export type SlideVersion = { content: SlideContent; notes: string };
export type Slide = Omit<SlideRow, 'layout' | 'points' | 'content' | 'previous'> & {
  layout: SlideLayout;
  points: string[];
  content: SlideContent | null;
  previous: SlideVersion | null;
};
export type Run = Omit<RunRow, 'targets' | 'done'> & { targets: string[]; done: string[] };
export type Material = Omit<MaterialRow, 'kind'> & { kind: DeckMaterialKind };

const idsSchema = z.array(z.string());
const pointsSchema = z.array(z.string());
const versionSchema = z.object({ content: slideContentSchema, notes: z.string() });

// JSON columns are parsed at the boundary (06 §9).
const json = <T>(schema: z.ZodType<T>, value: string): T => schema.parse(JSON.parse(value));
const toDeck = ({ theme, understanding, ...row }: DeckRow): Deck => ({
  ...row,
  theme: themeIdSchema.parse(theme),
  understanding: understanding === null ? null : json(deckUnderstandingSchema, understanding),
});
const toSlide = ({ layout, points, content, previous, ...row }: SlideRow): Slide => ({
  ...row,
  layout: slideLayoutSchema.parse(layout),
  points: json(pointsSchema, points),
  content: content === null ? null : json(slideContentSchema, content),
  previous: previous === null ? null : json(versionSchema, previous),
});
const toRun = ({ targets, done, ...row }: RunRow): Run => ({
  ...row,
  targets: json(idsSchema, targets),
  done: json(idsSchema, done),
});
const toMaterial = ({ kind, ...row }: MaterialRow): Material => ({ ...row, kind: deckMaterialKindSchema.parse(kind) });

/** `%`, `_` and the escape character itself match literally in a LIKE pattern. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function createDecksRepo(db: DbExecutor) {
  const d = decksTable;
  const s = deckSlidesTable;
  const r = deckRunsTable;
  const m = deckMaterialsTable;

  return {
    insertDeck(deck: Deck): void {
      db.insert(d)
        .values({
          ...deck,
          understanding: deck.understanding === null ? null : JSON.stringify(deck.understanding),
        })
        .run();
    },
    findDeck(id: string): Deck | undefined {
      const row = db.select().from(d).where(eq(d.id, id)).get();
      return row === undefined ? undefined : toDeck(row);
    },
    updateDeck(
      id: string,
      patch: Partial<
        Pick<Deck, 'title' | 'titleEdited' | 'theme' | 'understanding' | 'outlineConfirmedAt' | 'updatedAt'>
      >,
    ): void {
      const { understanding, ...rest } = patch;
      db.update(d)
        .set({
          ...rest,
          ...(understanding === undefined
            ? {}
            : { understanding: understanding === null ? null : JSON.stringify(understanding) }),
        })
        .where(eq(d.id, id))
        .run();
    },
    /** Slides, materials and runs go with it (cascade); the runs' attempts are deleted by the caller. */
    deleteDeck(id: string): void {
      db.delete(d).where(eq(d.id, id)).run();
    },
    /** One page, most recently updated first (11 §1): `after` is where the previous page ended. */
    page(
      filter: { projectId?: string | undefined; query?: string | undefined },
      after: { updatedAt: number; id: string } | undefined,
      limit: number,
    ): Deck[] {
      const conditions: SQL[] = [];
      if (filter.projectId !== undefined) conditions.push(eq(d.projectId, filter.projectId));
      if (filter.query !== undefined) conditions.push(sql`${d.title} like ${likePattern(filter.query)} escape '\\'`);
      if (after !== undefined) {
        const older = or(lt(d.updatedAt, after.updatedAt), and(eq(d.updatedAt, after.updatedAt), lt(d.id, after.id)));
        if (older !== undefined) conditions.push(older);
      }
      return db
        .select()
        .from(d)
        .where(and(...conditions))
        .orderBy(desc(d.updatedAt), desc(d.id))
        .limit(limit)
        .all()
        .map(toDeck);
    },

    insertMaterials(materials: readonly Material[]): void {
      if (materials.length > 0)
        db.insert(m)
          .values([...materials])
          .run();
    },
    listMaterials(deckId: string): Material[] {
      return db.select().from(m).where(eq(m.deckId, deckId)).orderBy(asc(m.seq)).all().map(toMaterial);
    },

    insertSlides(slides: readonly Slide[]): void {
      if (slides.length === 0) return;
      db.insert(s)
        .values(
          slides.map((slide) => ({
            ...slide,
            points: JSON.stringify(slide.points),
            content: slide.content === null ? null : JSON.stringify(slide.content),
            previous: slide.previous === null ? null : JSON.stringify(slide.previous),
          })),
        )
        .run();
    },
    /** In page order. */
    listSlides(deckId: string): Slide[] {
      return db.select().from(s).where(eq(s.deckId, deckId)).orderBy(asc(s.seq)).all().map(toSlide);
    },
    /** The slides of several PPTs at once (a list page), in page order within each. */
    listSlidesOf(deckIds: readonly string[]): Slide[] {
      if (deckIds.length === 0) return [];
      return db.select().from(s).where(inArray(s.deckId, deckIds)).orderBy(asc(s.seq)).all().map(toSlide);
    },
    updateSlide(
      id: string,
      patch: Partial<Pick<Slide, 'seq' | 'layout' | 'title' | 'points' | 'content' | 'notes' | 'previous'>> & {
        updatedAt?: number;
      },
    ): void {
      const { points, content, previous, ...rest } = patch;
      db.update(s)
        .set({
          ...rest,
          ...(points === undefined ? {} : { points: JSON.stringify(points) }),
          ...(content === undefined ? {} : { content: content === null ? null : JSON.stringify(content) }),
          ...(previous === undefined ? {} : { previous: previous === null ? null : JSON.stringify(previous) }),
        })
        .where(eq(s.id, id))
        .run();
    },
    deleteSlides(ids: readonly string[]): void {
      if (ids.length > 0) db.delete(s).where(inArray(s.id, ids)).run();
    },

    insertRun(run: Run): void {
      db.insert(r)
        .values({ ...run, targets: JSON.stringify(run.targets), done: JSON.stringify(run.done) })
        .run();
    },
    /** Oldest first. */
    listRuns(deckId: string): Run[] {
      return db.select().from(r).where(eq(r.deckId, deckId)).orderBy(asc(r.seq)).all().map(toRun);
    },
    /** The runs of several PPTs at once, oldest first within each. */
    listRunsOf(deckIds: readonly string[]): Run[] {
      if (deckIds.length === 0) return [];
      return db.select().from(r).where(inArray(r.deckId, deckIds)).orderBy(asc(r.seq)).all().map(toRun);
    },
    findRunByAttempt(attemptId: string): Run | undefined {
      const row = db.select().from(r).where(eq(r.attemptId, attemptId)).get();
      return row === undefined ? undefined : toRun(row);
    },
    setRunDone(id: string, done: readonly string[]): void {
      db.update(r)
        .set({ done: JSON.stringify(done) })
        .where(eq(r.id, id))
        .run();
    },
  };
}
export type DecksRepo = ReturnType<typeof createDecksRepo>;
