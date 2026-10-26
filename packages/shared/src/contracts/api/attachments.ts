import { z } from 'zod';
import { ATTACHMENT_NAME_MAX_CHARS, ATTACHMENTS_PER_INPUT_MAX } from '../../constants/limits.ts';
import { AttachmentFormat, attachmentFormatSchema, attachmentSourceSchema } from '../../enums/attachment.ts';

/** A 1-based, inclusive line range of a project file. */
export const lineRangeSchema = z
  .object({ from: z.number().int().min(1), to: z.number().int().min(1) })
  .refine((r) => r.from <= r.to, { message: 'from must not be after to', path: ['to'] });
export type LineRange = z.infer<typeof lineRangeSchema>;

/** Where a project file snapshot was read (30 §2.1); paths are relative to the project or worktree root. */
export const attachmentOriginSchema = z.object({
  projectId: z.string(),
  /** The task whose worktree was read; null for the project's main working tree. */
  taskId: z.string().nullable(),
  path: z.string(),
  lines: lineRangeSchema.nullable(),
  readAt: z.number(),
});
export type AttachmentOrigin = z.infer<typeof attachmentOriginSchema>;

/** What a Word attachment holds (39 §5), as read when it was uploaded. */
export const docxMetaSchema = z.object({
  format: z.literal(AttachmentFormat.Docx),
  /** Characters of the body text the model reads. */
  chars: z.number(),
  headings: z.number(),
  tables: z.number(),
  /** Pictures in the body; the model sees a placeholder for each. */
  images: z.number(),
});

/** One sheet of an Excel attachment: its used range (null when empty) and size. */
export const sheetMetaSchema = z.object({
  name: z.string(),
  range: z.string().nullable(),
  rows: z.number(),
  columns: z.number(),
  hidden: z.boolean(),
});

/** What an Excel attachment holds (39 §5); charts, pictures and pivot tables are counted but not read. */
export const xlsxMetaSchema = z.object({
  format: z.literal(AttachmentFormat.Xlsx),
  sheets: z.array(sheetMetaSchema),
  formulas: z.number(),
  charts: z.number(),
  images: z.number(),
  pivotTables: z.number(),
});

export const officeMetaSchema = z.discriminatedUnion('format', [docxMetaSchema, xlsxMetaSchema]);
export type OfficeMeta = z.infer<typeof officeMetaSchema>;

/** An attachment's metadata (11 §14.1); never the server path. Its text is `GET /attachments/:id/content`. */
export const attachmentSchema = z.object({
  id: z.string(),
  source: attachmentSourceSchema,
  name: z.string(),
  sizeBytes: z.number(),
  /** Project file snapshots only. */
  origin: attachmentOriginSchema.nullable(),
  format: attachmentFormatSchema,
  /** Word and Excel attachments only. */
  meta: officeMetaSchema.nullable(),
  createdAt: z.number(),
});
export type AttachmentDTO = z.infer<typeof attachmentSchema>;

/** The display name sent with an upload, URL-encoded in the `ATTACHMENT_NAME_HEADER` header. */
export const attachmentNameSchema = z.string().trim().min(1).max(ATTACHMENT_NAME_MAX_CHARS);

/** The attachments sent with one input, in their order (30 §2); bound to it in the same transaction. */
export const attachmentIdsSchema = z.array(z.string()).max(ATTACHMENTS_PER_INPUT_MAX);

/** `POST /attachments/project-file` (30 §2.1). */
export const snapshotProjectFileSchema = z.object({
  projectId: z.string(),
  /** Read the task's worktree instead of the project's main working tree. */
  taskId: z.string().optional(),
  /** Relative to the root; `/` separated. */
  path: z.string().min(1),
  lines: lineRangeSchema.optional(),
});
export type SnapshotProjectFileRequest = z.infer<typeof snapshotProjectFileSchema>;
