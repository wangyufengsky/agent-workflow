import type { GitReviewTarget } from '@aw/shared';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { attemptsTable } from '../attempts/attempts.table.ts';
import { projectsTable } from '../projects/projects.table.ts';

/** 10 §git_reviews: an AI review in the Git workbench (27 §7.2); its status is its attempt's. */
export const gitReviewsTable = sqliteTable(
  'git_reviews',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projectsTable.id, { onDelete: 'cascade' }),
    target: text('target').$type<GitReviewTarget>().notNull(),
    /** A branch name or a short SHA, for display. */
    label: text('label').notNull(),
    fromSha: text('from_sha').notNull(),
    /** For a commit: which parent (1-based) it is compared with, so that it can be reviewed against it again. */
    parent: integer('parent'),
    /** Null for the main worktree's uncommitted changes. */
    toSha: text('to_sha'),
    focus: text('focus'),
    attemptId: text('attempt_id')
      .notNull()
      .references(() => attemptsTable.id),
    /** JSON `DiffFile[]`: the changed files when the review started. */
    files: text('files').notNull(),
    summary: text('summary'),
    /** JSON `GitFindingDTO[]`, written with the summary by `submit_findings`. */
    findings: text('findings'),
    createdAt: integer('created_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [
    index('git_reviews_project_idx').on(t.projectId, t.createdAt),
    index('git_reviews_attempt_idx').on(t.attemptId),
  ],
);
