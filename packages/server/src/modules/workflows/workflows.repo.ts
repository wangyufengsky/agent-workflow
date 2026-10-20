import { type WorkflowDTO, workflowDefinitionSchema } from '@aw/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../core/db/database.ts';
import { workflowsTable } from './workflows.table.ts';

type WorkflowRow = typeof workflowsTable.$inferSelect;

function toWorkflow({ isLatest: _latest, definition, ...row }: WorkflowRow): WorkflowDTO {
  // JSON column: parsed at the boundary (06 §9).
  return { ...row, definition: workflowDefinitionSchema.parse(JSON.parse(definition)) };
}

export function createWorkflowsRepo(db: DbExecutor) {
  return {
    /** Latest versions, in the order the workflows were first added. */
    listLatest(): WorkflowDTO[] {
      const firstAdded = sql`(select min(w.rowid) from ${workflowsTable} w where w.key = ${workflowsTable.key})`;
      return db
        .select()
        .from(workflowsTable)
        .where(eq(workflowsTable.isLatest, true))
        .orderBy(asc(firstAdded))
        .all()
        .map(toWorkflow);
    },
    find(id: string): WorkflowDTO | undefined {
      const row = db.select().from(workflowsTable).where(eq(workflowsTable.id, id)).get();
      return row === undefined ? undefined : toWorkflow(row);
    },
    findLatest(key: string): WorkflowDTO | undefined {
      const row = db
        .select()
        .from(workflowsTable)
        .where(and(eq(workflowsTable.key, key), eq(workflowsTable.isLatest, true)))
        .get();
      return row === undefined ? undefined : toWorkflow(row);
    },
    /** Every version of the key, newest first (also those of a deleted workflow kept for its tasks). */
    listVersions(key: string): WorkflowDTO[] {
      return db
        .select()
        .from(workflowsTable)
        .where(eq(workflowsTable.key, key))
        .orderBy(desc(workflowsTable.version))
        .all()
        .map(toWorkflow);
    },
    /** A deleted workflow keeps the versions its tasks use, none of them listed (11 §4). */
    unlist(key: string): void {
      db.update(workflowsTable).set({ isLatest: false }).where(eq(workflowsTable.key, key)).run();
    },
    delete(ids: readonly string[]): void {
      if (ids.length > 0) db.delete(workflowsTable).where(inArray(workflowsTable.id, ids)).run();
    },
    /** Adds a version and makes it the latest one. */
    insertLatest(workflow: WorkflowDTO): void {
      db.update(workflowsTable)
        .set({ isLatest: false })
        .where(and(eq(workflowsTable.key, workflow.key), eq(workflowsTable.isLatest, true)))
        .run();
      db.insert(workflowsTable)
        .values({ ...workflow, isLatest: true, definition: JSON.stringify(workflow.definition) })
        .run();
    },
  };
}
