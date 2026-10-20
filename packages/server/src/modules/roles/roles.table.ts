import type { RoleBaseAgent, RoleKind } from '@aw/shared';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const rolesTable = sqliteTable('roles', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  kind: text('kind').$type<RoleKind>().notNull(),
  baseAgent: text('base_agent').$type<RoleBaseAgent>().notNull(),
  description: text('description').notNull(),
  /** Markdown appended to the agent prompt as the session's `system` (12 §2). */
  prompt: text('prompt').notNull(),
  /** `provider/model`. */
  model: text('model'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
