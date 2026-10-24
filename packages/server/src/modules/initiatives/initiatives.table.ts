import type { InitiativeTemplateKind } from '@aw/shared';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { projectsTable } from '../projects/projects.table.ts';
import { tasksTable } from '../tasks/tasks.table.ts';

/** 10 §initiative_templates (34 §15.8): built-in ones are rewritten on every start; not versioned (snapshots). */
export const initiativeTemplatesTable = sqliteTable('initiative_templates', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  kind: text('kind').$type<InitiativeTemplateKind>().notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  /** Listing order: the built-in order. */
  position: integer('position').notNull(),
  /** JSON `InitiativePhase[]`. */
  phases: text('phases').notNull(),
  /** JSON `InitiativeItemSpec[]`, requirements still with `{{requirement}}`. */
  items: text('items').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * 10 §initiatives (34 §9): no status column — its state is derived from these facts and its tasks (34 §6.2).
 * `breakdown_rev` / `confirmed_rev` / `opened_phase` only ever grow.
 */
export const initiativesTable = sqliteTable(
  'initiatives',
  {
    id: text('id').primaryKey(),
    /** Shown as `I-<seq>`. */
    seq: integer('seq').notNull().unique(),
    projectId: text('project_id')
      .notNull()
      .references(() => projectsTable.id, { onDelete: 'cascade' }),
    /** Where it came from, for the page header only. */
    templateId: text('template_id').references(() => initiativeTemplatesTable.id, { onDelete: 'set null' }),
    baseBranch: text('base_branch').notNull(),
    title: text('title').notNull(),
    requirement: text('requirement').notNull(),
    /** JSON `InitiativePhase[]`. */
    phases: text('phases').notNull(),
    confirmItemPlans: integer('confirm_item_plans', { mode: 'boolean' }).notNull(),
    breakdownRev: integer('breakdown_rev').notNull(),
    confirmedRev: integer('confirmed_rev').notNull(),
    openedPhase: integer('opened_phase').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('initiatives_project_idx').on(t.projectId, t.seq)],
);

/** 10 §initiative_items: one work package; at run time one ordinary task (34 §2). */
export const initiativeItemsTable = sqliteTable(
  'initiative_items',
  {
    id: text('id').primaryKey(),
    initiativeId: text('initiative_id')
      .notNull()
      .references(() => initiativesTable.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    /** Order within the initiative as written. */
    ordinal: integer('ordinal').notNull(),
    title: text('title').notNull(),
    phase: integer('phase').notNull(),
    workflowKey: text('workflow_key').notNull(),
    requirement: text('requirement').notNull(),
    /** JSON item keys. */
    dependsOn: text('depends_on').notNull(),
    /** JSON `RequirementItemInput[]`: the task's checklist. */
    acceptance: text('acceptance').notNull(),
    /** The current task; replaced when the user starts the work package again. */
    taskId: text('task_id').references(() => tasksTable.id, { onDelete: 'set null' }),
    /** JSON `ErrorInfo`: why starting the task last failed. */
    startError: text('start_error'),
    mergeConfirmedAt: integer('merge_confirmed_at'),
    droppedAt: integer('dropped_at'),
    dropReason: text('drop_reason'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('initiative_items_key_unique').on(t.initiativeId, t.key),
    index('initiative_items_task_idx').on(t.taskId),
  ],
);
