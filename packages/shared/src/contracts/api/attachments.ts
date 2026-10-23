import { z } from 'zod';
import { ATTACHMENT_NAME_MAX_CHARS, ATTACHMENTS_PER_INPUT_MAX } from '../../constants/limits.ts';
import { attachmentSourceSchema } from '../../enums/attachment.ts';

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

/** An attachment's metadata (11 §14.1); never the server path. Its content is `GET /attachments/:id/content`. */
export const attachmentSchema = z.object({
  id: z.string(),
  source: attachmentSourceSchema,
  name: z.string(),
  sizeBytes: z.number(),
  /** Project file snapshots only. */
  origin: attachmentOriginSchema.nullable(),
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
