import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { projectsTable } from '../projects/projects.table.ts';

export const browserCasesTable = sqliteTable(
  'browser_cases',
  {
    caseId: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projectsTable.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    definition: text('definition').notNull(),
  },
  (t) => [index('browser_cases_project_idx').on(t.projectId)],
);
