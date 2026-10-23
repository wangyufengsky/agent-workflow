import { type RequirementItem, type RequirementResultDTO, requirementItemSchema } from '@aw/shared';
import { asc, desc, eq, sql } from 'drizzle-orm';
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
    /** In the order they were given. */
    listResults(taskId: string): RequirementResultDTO[] {
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
            createdAt: r.createdAt,
          })
          .from(r)
          .where(eq(r.taskId, taskId))
          // Insertion order: two conclusions can share a millisecond.
          .orderBy(asc(sql`rowid`))
          .all()
      );
    },
  };
}
