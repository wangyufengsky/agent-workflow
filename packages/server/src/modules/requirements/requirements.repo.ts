import { type RequirementItem, type RequirementResultDTO, requirementItemSchema } from '@aw/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbExecutor } from '../../core/db/database.ts';
import { requirementResultsTable, requirementRevisionsTable } from './requirements.table.ts';

type RevisionRow = typeof requirementRevisionsTable.$inferSelect;
export type Revision = Omit<RevisionRow, 'items'> & { items: RequirementItem[] };

const itemsSchema = z.array(requirementItemSchema);
// JSON columns are parsed at the boundary (06 §9).
const toRevision = ({ items, ...row }: RevisionRow): Revision => ({
  ...row,
  items: itemsSchema.parse(JSON.parse(items)),
});

export function createRequirementsRepo(db: DbExecutor) {
  const v = requirementRevisionsTable;
  const r = requirementResultsTable;
  return {
    insertRevision(revision: Revision): void {
      db.insert(v)
        .values({ ...revision, items: JSON.stringify(revision.items) })
        .run();
    },
    /** Newest first. */
    listRevisions(taskId: string): Revision[] {
      return db.select().from(v).where(eq(v.taskId, taskId)).orderBy(desc(v.seq)).all().map(toRevision);
    },
    listRevisionsOf(taskIds: readonly string[]): Revision[] {
      return taskIds.length === 0
        ? []
        : db
            .select()
            .from(v)
            .where(inArray(v.taskId, [...taskIds]))
            .orderBy(desc(v.seq))
            .all()
            .map(toRevision);
    },
    listResultsOf(taskIds: readonly string[]): Array<RequirementResultDTO & { taskId: string }> {
      if (taskIds.length === 0) return [];
      return db
        .select({
          taskId: r.taskId,
          id: r.id,
          itemId: r.itemId,
          revisionId: r.revisionId,
          source: r.source,
          conclusion: r.conclusion,
          note: r.note,
          output: r.output,
          commitSha: r.commitSha,
          nodeId: r.nodeId,
          createdAt: r.createdAt,
        })
        .from(r)
        .where(inArray(r.taskId, [...taskIds]))
        .orderBy(asc(sql`rowid`))
        .all();
    },
    findRevision(taskId: string, revisionId: string): Revision | undefined {
      const row = db
        .select()
        .from(v)
        .where(and(eq(v.taskId, taskId), eq(v.id, revisionId)))
        .get();
      return row === undefined ? undefined : toRevision(row);
    },
    insertResults(results: ReadonlyArray<typeof r.$inferInsert>): void {
      if (results.length > 0)
        db.insert(r)
          .values([...results])
          .run();
    },
    /** In the order they were given. */
    listResults(taskId: string, revisionId?: string): RequirementResultDTO[] {
      return (
        db
          .select({
            id: r.id,
            itemId: r.itemId,
            revisionId: r.revisionId,
            source: r.source,
            conclusion: r.conclusion,
            note: r.note,
            output: r.output,
            commitSha: r.commitSha,
            nodeId: r.nodeId,
            createdAt: r.createdAt,
          })
          .from(r)
          .where(
            revisionId === undefined ? eq(r.taskId, taskId) : and(eq(r.taskId, taskId), eq(r.revisionId, revisionId)),
          )
          // Insertion order: two conclusions can share a millisecond.
          .orderBy(asc(sql`rowid`))
          .all()
      );
    },
  };
}
