import type { HostingProvider } from '@aw/shared';
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { credentialsTable } from '../credentials/index.ts';

export const projectsTable = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Directory name under the worktree root. */
  slug: text('slug').notNull().unique(),
  /** Repository root, symlinks resolved. */
  repoPath: text('repo_path').notNull().unique(),
  defaultBranch: text('default_branch').notNull(),
  checkCommand: text('check_command'),
  hostingProvider: text('hosting_provider').$type<HostingProvider>(),
  hostingBaseUrl: text('hosting_base_url'),
  hostingRepo: text('hosting_repo'),
  hostingCredentialId: text('hosting_credential_id').references(() => credentialsTable.id, { onDelete: 'set null' }),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** 10 §project_bash_rules: bash patterns the user always allowed for the project's AI sessions (D101). */
export const projectBashRulesTable = sqliteTable(
  'project_bash_rules',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projectsTable.id, { onDelete: 'cascade' }),
    /** opencode wildcard, e.g. `unzip *`. */
    pattern: text('pattern').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.pattern] })],
);
