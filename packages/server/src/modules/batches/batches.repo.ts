import { and, desc, eq, inArray, lt, type SQL, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../core/db/database.ts';
import { projectsTable } from '../projects/index.ts';
import { workflowsTable } from '../workflows/index.ts';
import { batchesTable, batchTasksTable } from './batches.table.ts';

type BatchRow = typeof batchesTable.$inferSelect;

/** A batch with the names of its project and workflow. */
export type Batch = BatchRow & {
  projectName: string;
  workflowKey: string;
  workflowName: string;
  workflowDeliverable: typeof workflowsTable.$inferSelect.deliverable;
};

export type BatchLink = typeof batchTasksTable.$inferSelect;

export function createBatchesRepo(db: DbExecutor) {
  const b = batchesTable;
  const select = (where: SQL | undefined) =>
    db
      .select({
        batch: b,
        projectName: projectsTable.name,
        workflowKey: workflowsTable.key,
        workflowName: workflowsTable.name,
        workflowDeliverable: workflowsTable.deliverable,
      })
      .from(b)
      .innerJoin(projectsTable, eq(projectsTable.id, b.projectId))
      .innerJoin(workflowsTable, eq(workflowsTable.id, b.workflowId))
      .where(where);
  const toBatch = ({ batch, ...names }: { batch: BatchRow } & Omit<Batch, keyof BatchRow>): Batch => ({
    ...batch,
    ...names,
  });

  return {
    /** Numbers the batch and inserts it; returns its seq. */
    insert(batch: Omit<BatchRow, 'seq'>): number {
      const row = db
        .select({ max: sql<number | null>`max(${b.seq})` })
        .from(b)
        .get();
      const seq = (row?.max ?? 0) + 1;
      db.insert(b)
        .values({ ...batch, seq })
        .run();
      return seq;
    },
    link(link: BatchLink): void {
      db.insert(batchTasksTable).values(link).run();
    },
    /** The batch a task was made for, if any. */
    batchOfTask(taskId: string): string | undefined {
      const bt = batchTasksTable;
      return db.select({ id: bt.batchId }).from(bt).where(eq(bt.taskId, taskId)).get()?.id;
    },
    find(id: string): Batch | undefined {
      const row = select(eq(b.id, id)).get();
      return row === undefined ? undefined : toBatch(row);
    },
    /** Newest first; `beforeSeq` is where the previous page ended. */
    page(filter: { projectId: string | undefined; beforeSeq: number | undefined; limit: number }): Batch[] {
      return select(
        and(
          ...(filter.projectId === undefined ? [] : [eq(b.projectId, filter.projectId)]),
          ...(filter.beforeSeq === undefined ? [] : [lt(b.seq, filter.beforeSeq)]),
        ),
      )
        .orderBy(desc(b.seq))
        .limit(filter.limit)
        .all()
        .map(toBatch);
    },
    /** The tasks of the given batches, in target order. */
    links(batchIds: readonly string[]): BatchLink[] {
      return db
        .select()
        .from(batchTasksTable)
        .where(inArray(batchTasksTable.batchId, batchIds))
        .orderBy(batchTasksTable.position)
        .all();
    },
  };
}
