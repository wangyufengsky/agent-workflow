import type { AttachmentOwnerKind, AttachmentSource } from '@aw/shared';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** 10 §6.1 attachments: an immutable original at `attachments/<id>/original`; a row exists only once it is valid. */
export const attachmentsTable = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    source: text('source').$type<AttachmentSource>().notNull(),
    name: text('name').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** JSON `AttachmentOrigin`; project file snapshots only. */
    origin: text('origin'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('attachments_created_idx').on(t.createdAt)],
);

/**
 * 10 §6.1 attachment_refs: who uses an attachment. The owner is polymorphic (no foreign key); its module creates and
 * deletes the references in its own transactions. The attachment stays while any reference does.
 */
export const attachmentRefsTable = sqliteTable(
  'attachment_refs',
  {
    ownerKind: text('owner_kind').$type<AttachmentOwnerKind>().notNull(),
    ownerId: text('owner_id').notNull(),
    attachmentId: text('attachment_id')
      .notNull()
      .references(() => attachmentsTable.id),
    ordinal: integer('ordinal').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerKind, t.ownerId, t.attachmentId] }),
    index('attachment_refs_attachment_idx').on(t.attachmentId),
  ],
);
