import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { tasksTable } from '../tasks/tasks.table.ts';

export const functionalTestsTable = sqliteTable('functional_tests', {
  taskId: text('task_id')
    .primaryKey()
    .references(() => tasksTable.id, { onDelete: 'cascade' }),
  snapshot: text('snapshot').notNull(),
});
