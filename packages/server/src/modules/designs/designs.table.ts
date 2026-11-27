import { PermissionMode } from '@aw/shared';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { attemptsTable } from '../attempts/attempts.table.ts';
import { projectsTable } from '../projects/projects.table.ts';

export const projectDesignsTable = sqliteTable(
  'project_designs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').references(() => projectsTable.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    depth: text('depth').notNull(),
    templateKey: text('template_key').notNull(),
    templateSnapshot: text('template_snapshot').notNull(),
    layoutStyle: text('layout_style').notNull(),
    theme: text('theme').notNull(),
    excludePatterns: text('exclude_patterns').notNull(),
    permissionMode: text('permission_mode').$type<PermissionMode>().notNull().default(PermissionMode.Ask),
    aiReviewEnabled: integer('ai_review_enabled', { mode: 'boolean' }).notNull(),
    sourceSnapshot: text('source_snapshot').notNull(),
    outlineConfirmedAt: integer('outline_confirmed_at'),
    lastExportedPath: text('last_exported_path'),
    lastExportedAt: integer('last_exported_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('project_designs_project_idx').on(t.projectId, t.updatedAt, t.id),
    index('project_designs_updated_idx').on(t.updatedAt, t.id),
  ],
);

export const designSectionsTable = sqliteTable(
  'design_sections',
  {
    id: text('id').primaryKey(),
    designId: text('design_id')
      .notNull()
      .references(() => projectDesignsTable.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    selected: integer('is_selected', { mode: 'boolean' }).notNull().default(true),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    scopePaths: text('scope_paths').notNull(),
    summary: text('summary').notNull(),
    blocks: text('blocks'),
    reviewState: text('review_state').notNull(),
    reviewNotes: text('review_notes'),
    previous: text('previous'),
    sourceHashes: text('source_hashes'),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('design_sections_design_seq_idx').on(t.designId, t.seq)],
);

export const designFilesTable = sqliteTable(
  'design_files',
  {
    id: text('id').primaryKey(),
    designId: text('design_id')
      .notNull()
      .references(() => projectDesignsTable.id, { onDelete: 'cascade' }),
    sectionId: text('section_id').references(() => designSectionsTable.id, { onDelete: 'set null' }),
    relPath: text('rel_path').notNull(),
    contentHash: text('content_hash').notNull(),
    responsibility: text('responsibility'),
    symbols: text('symbols').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('design_files_design_path_idx').on(t.designId, t.relPath),
    index('design_files_design_section_idx').on(t.designId, t.sectionId),
  ],
);

export const designDiagramsTable = sqliteTable(
  'design_diagrams',
  {
    id: text('id').primaryKey(),
    designId: text('design_id')
      .notNull()
      .references(() => projectDesignsTable.id, { onDelete: 'cascade' }),
    sectionId: text('section_id')
      .notNull()
      .references(() => designSectionsTable.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    nodes: text('nodes').notNull(),
    edges: text('edges').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('design_diagrams_design_section_idx').on(t.designId, t.sectionId)],
);

export const designRunsTable = sqliteTable(
  'design_runs',
  {
    id: text('id').primaryKey(),
    designId: text('design_id')
      .notNull()
      .references(() => projectDesignsTable.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    attemptId: text('attempt_id')
      .notNull()
      .references(() => attemptsTable.id),
    targetSectionIds: text('target_section_ids').notNull(),
    doneSectionIds: text('done_section_ids').notNull(),
    instruction: text('instruction'),
    isIncremental: integer('is_incremental', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('design_runs_design_seq_idx').on(t.designId, t.seq), index('design_runs_attempt_idx').on(t.attemptId)],
);

export const designTemplatesTable = sqliteTable('design_templates', {
  key: text('key').primaryKey(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  matchHints: text('match_hints').notNull(),
  defaultSections: text('default_sections').notNull(),
  focusPrompt: text('focus_prompt').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
