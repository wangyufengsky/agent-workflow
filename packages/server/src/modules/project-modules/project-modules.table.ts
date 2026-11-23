import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { projectsTable } from '../projects/projects.table.ts';

export const moduleCatalogTable = sqliteTable('project_module_catalogs', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projectsTable.id, { onDelete: 'cascade' }),
  catalog: text('catalog').notNull(),
  defaults: text('defaults').notNull().default('{}'),
});
export const moduleRunsTable = sqliteTable(
  'project_module_runs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projectsTable.id, { onDelete: 'cascade' }),
    startedAt: integer('started_at').notNull(),
    result: text('result').notNull(),
  },
  (t) => [index('idx_project_module_runs_recent').on(t.projectId, t.startedAt)],
);
