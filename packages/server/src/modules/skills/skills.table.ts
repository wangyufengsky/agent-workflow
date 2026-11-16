import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { projectsTable } from '../projects/projects.table.ts';

export const userSkillsTable = sqliteTable(
  'user_skills',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    source: text('source').notNull(),
    version: integer('version').notNull(),
  },
  (t) => [uniqueIndex('user_skills_name_idx').on(t.name)],
);

export const projectSkillBindingsTable = sqliteTable(
  'project_skill_bindings',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projectsTable.id, { onDelete: 'cascade' }),
    workflowKey: text('workflow_key').notNull(),
    skillId: text('skill_id')
      .notNull()
      .references(() => userSkillsTable.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.workflowKey, t.skillId] })],
);
