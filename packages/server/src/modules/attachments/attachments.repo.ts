import { type AttachmentDTO, type AttachmentOwnerKind, attachmentOriginSchema, officeMetaSchema } from '@aw/shared';
import { and, asc, eq, inArray, lt, notExists } from 'drizzle-orm';
import type { DbExecutor } from '../../core/db/database.ts';
import { attachmentRefsTable, attachmentsTable } from './attachments.table.ts';

type AttachmentRow = typeof attachmentsTable.$inferSelect;
export type Owner = { kind: AttachmentOwnerKind; id: string };

// JSON columns are parsed at the boundary (06 §9).
const toAttachment = ({ origin, meta, ...row }: AttachmentRow): AttachmentDTO => ({
  ...row,
  origin: origin === null ? null : attachmentOriginSchema.parse(JSON.parse(origin)),
  meta: meta === null ? null : officeMetaSchema.parse(JSON.parse(meta)),
});

export function createAttachmentsRepo(db: DbExecutor) {
  const a = attachmentsTable;
  const r = attachmentRefsTable;
  const unreferenced = notExists(db.select().from(r).where(eq(r.attachmentId, a.id)));

  return {
    insert(attachment: AttachmentDTO): void {
      const { origin, meta, ...row } = attachment;
      db.insert(a)
        .values({
          ...row,
          origin: origin === null ? null : JSON.stringify(origin),
          meta: meta === null ? null : JSON.stringify(meta),
        })
        .run();
    },
    find(id: string): AttachmentDTO | undefined {
      const row = db.select().from(a).where(eq(a.id, id)).get();
      return row === undefined ? undefined : toAttachment(row);
    },
    findMany(ids: readonly string[]): AttachmentDTO[] {
      return db
        .select()
        .from(a)
        .where(inArray(a.id, [...ids]))
        .all()
        .map(toAttachment);
    },
    isReferenced(id: string): boolean {
      return db.select().from(r).where(eq(r.attachmentId, id)).limit(1).get() !== undefined;
    },
    delete(id: string): void {
      db.delete(a).where(eq(a.id, id)).run();
    },
    insertRefs(owner: Owner, attachmentIds: readonly string[], createdAt: number): void {
      if (attachmentIds.length === 0) return;
      db.insert(r)
        .values(
          attachmentIds.map((attachmentId, ordinal) => ({
            ownerKind: owner.kind,
            ownerId: owner.id,
            attachmentId,
            ordinal,
            createdAt,
          })),
        )
        // An assistant conversation may carry the same file again in a later message: it keeps its first reference.
        .onConflictDoNothing()
        .run();
    },
    /** The owner's attachments in the order they were sent: by message, then by position in it. */
    listByOwner(owner: Owner): AttachmentDTO[] {
      return db
        .select({ attachment: a })
        .from(r)
        .innerJoin(a, eq(a.id, r.attachmentId))
        .where(and(eq(r.ownerKind, owner.kind), eq(r.ownerId, owner.id)))
        .orderBy(asc(r.createdAt), asc(r.ordinal))
        .all()
        .map(({ attachment }) => toAttachment(attachment));
    },
    deleteRefs(kind: AttachmentOwnerKind, ownerIds: readonly string[]): void {
      db.delete(r)
        .where(and(eq(r.ownerKind, kind), inArray(r.ownerId, [...ownerIds])))
        .run();
    },
    /** Deletes the attachments nothing references that were created before `before`; returns their ids. */
    deleteOrphans(before: number): string[] {
      return db
        .delete(a)
        .where(and(lt(a.createdAt, before), unreferenced))
        .returning({ id: a.id })
        .all()
        .map((row) => row.id);
    },
    ids(): Set<string> {
      return new Set(
        db
          .select({ id: a.id })
          .from(a)
          .all()
          .map((row) => row.id),
      );
    },
  };
}
