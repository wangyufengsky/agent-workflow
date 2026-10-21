import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { attemptsTable } from '../attempts/attempts.table.ts';
import { projectsTable } from '../projects/projects.table.ts';

/** 10 §decks (23 §3): a PPT, its brief and theme; its status is derived (23 §4.3). */
export const decksTable = sqliteTable(
  'decks',
  {
    id: text('id').primaryKey(),
    /** The project whose code the AI may read; the PPT stays when the project is deleted. */
    projectId: text('project_id').references(() => projectsTable.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    /** Renamed by the user: the outline no longer sets the title. */
    titleEdited: integer('title_edited', { mode: 'boolean' }).notNull(),
    brief: text('brief').notNull(),
    /** Pages asked for; null = the AI decides. */
    slideCountTarget: integer('slide_count_target'),
    theme: text('theme').notNull(),
    /** JSON `DeckUnderstanding`, with the outline. */
    understanding: text('understanding'),
    /** Written once: before it the PPT is an outline, after it pages are made. */
    outlineConfirmedAt: integer('outline_confirmed_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('decks_project_idx').on(t.projectId), index('decks_updated_idx').on(t.updatedAt)],
);

/** 10 §deck_materials: material snapshotted when the PPT is created; never changes. */
export const deckMaterialsTable = sqliteTable(
  'deck_materials',
  {
    id: text('id').primaryKey(),
    deckId: text('deck_id')
      .notNull()
      .references(() => decksTable.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    kind: text('kind').notNull(),
    /** The task or knowledge conversation it was taken from; no foreign key, the snapshot outlives it. */
    refId: text('ref_id'),
    title: text('title').notNull(),
    content: text('content').notNull(),
  },
  (t) => [index('deck_materials_deck_idx').on(t.deckId)],
);

/** 10 §deck_slides: one page, its outline and, once made, its content. */
export const deckSlidesTable = sqliteTable(
  'deck_slides',
  {
    id: text('id').primaryKey(),
    deckId: text('deck_id')
      .notNull()
      .references(() => decksTable.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    layout: text('layout').notNull(),
    title: text('title').notNull(),
    /** JSON `string[]`: what the page is to say. */
    points: text('points').notNull(),
    /** JSON `SlideContent`; null until made. */
    content: text('content'),
    notes: text('notes').notNull(),
    /** JSON `{ content, notes }` before the latest AI change, for「恢复上一版」. */
    previous: text('previous'),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('deck_slides_deck_seq_idx').on(t.deckId, t.seq)],
);

/** 10 §deck_runs: one AI work on a PPT; its kind and status are its attempt's. */
export const deckRunsTable = sqliteTable(
  'deck_runs',
  {
    id: text('id').primaryKey(),
    deckId: text('deck_id')
      .notNull()
      .references(() => decksTable.id, { onDelete: 'cascade' }),
    /** Order within the PPT, from 1. */
    seq: integer('seq').notNull(),
    attemptId: text('attempt_id')
      .notNull()
      .references(() => attemptsTable.id),
    /** JSON slide ids the work makes or revises; empty for an outline. */
    targets: text('targets').notNull(),
    /** JSON slide ids submitted so far. */
    done: text('done').notNull(),
    instruction: text('instruction'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('deck_runs_deck_idx').on(t.deckId, t.seq), index('deck_runs_attempt_idx').on(t.attemptId)],
);
