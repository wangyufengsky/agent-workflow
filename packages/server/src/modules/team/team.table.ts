import type { TeamAnalysisStatus } from '@aw/shared';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { projectsTable } from '../projects/projects.table.ts';

/**
 * 10 §team_commits: what one commit of a project repository is, read once (33 §7.1). A commit never changes, so the
 * rows never go stale; which branch reaches a commit is worked out each time, not stored.
 */
export const teamCommitsTable = sqliteTable(
  'team_commits',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projectsTable.id, { onDelete: 'cascade' }),
    sha: text('sha').notNull(),
    /** After the repository's `.mailmap`, lower-cased. */
    authorEmail: text('author_email').notNull(),
    authorName: text('author_name').notNull(),
    authoredAt: integer('authored_at').notNull(),
    subject: text('subject').notNull(),
    /** Committed by this app's tasks (author `GIT_COMMIT_IDENTITY`). */
    aiTask: integer('ai_task', { mode: 'boolean' }).notNull(),
    /** Another AI tool's `Co-Authored-By` (33 §2.5). */
    aiCoauthor: integer('ai_coauthor', { mode: 'boolean' }).notNull(),
    /** The task starter's lower-cased email and name from the trailer (D130). */
    requestedByEmail: text('requested_by_email'),
    requestedByName: text('requested_by_name'),
    /** The commit this one reverts (`This reverts commit <sha>`). */
    revertsSha: text('reverts_sha'),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.sha] }),
    index('team_commits_authored_idx').on(t.projectId, t.authoredAt),
  ],
);

/** 10 §team_commit_files: one commit's numstat, one row per file; null counts for a binary file. */
export const teamCommitFilesTable = sqliteTable(
  'team_commit_files',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projectsTable.id, { onDelete: 'cascade' }),
    sha: text('sha').notNull(),
    path: text('path').notNull(),
    added: integer('added'),
    deleted: integer('deleted'),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.sha, t.path] })],
);

/** 10 §team_identities: how an author email counts (33 §2.3); emails without a row are their own members. */
export const teamIdentitiesTable = sqliteTable(
  'team_identities',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projectsTable.id, { onDelete: 'cascade' }),
    /** Lower-cased. */
    email: text('email').notNull(),
    /** The main identity it is merged into; null for a main identity. */
    memberEmail: text('member_email'),
    displayName: text('display_name'),
    hidden: integer('hidden', { mode: 'boolean' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.email] })],
);

/** 10 §team_settings: how lines are counted for a project (33 §2.4); a null column is the default. */
export const teamSettingsTable = sqliteTable('team_settings', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projectsTable.id, { onDelete: 'cascade' }),
  /** JSON string arrays. */
  excludeGlobs: text('exclude_globs'),
  testGlobs: text('test_globs'),
  hugeCommitLines: integer('huge_commit_lines'),
});

/** 10 §team_analyses: an AI analysis of one member's work over a range of a branch (33 §6, D131). */
export const teamAnalysesTable = sqliteTable(
  'team_analyses',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projectsTable.id, { onDelete: 'cascade' }),
    /** The member's main email when it was asked for. */
    memberEmail: text('member_email').notNull(),
    ref: text('ref').notNull(),
    /** The branch's newest commit when it was asked for. */
    refSha: text('ref_sha').notNull(),
    periodFrom: text('period_from').notNull(),
    periodTo: text('period_to').notNull(),
    status: text('status').$type<TeamAnalysisStatus>().notNull(),
    /** JSON string array: the member's commits in the range, which the report may cite. */
    commits: text('commits').notNull(),
    /** JSON `{ sha, subject, lines }[]`: the commits to review. */
    sample: text('sample').notNull(),
    /** Null until its turn comes. */
    attemptId: text('attempt_id'),
    /** JSON `SubmitMemberAnalysisInput`. */
    report: text('report'),
    /** JSON `ErrorInfo`. */
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [
    index('team_analyses_project_idx').on(t.projectId, t.createdAt),
    index('team_analyses_attempt_idx').on(t.attemptId),
  ],
);
