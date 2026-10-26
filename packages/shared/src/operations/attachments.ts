import { z } from 'zod';
import { attachmentSchema, sheetPreviewSchema, snapshotProjectFileSchema } from '../contracts/api/attachments.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

const byId = z.object({ id: z.string() });
// The attachment bar's own calls (30 §2); uploads and contents are binary routes outside the registry (11 §14.1).
const common = { expose: { palette: false, assistant: false }, credentialFields: [], mode: UiMode.Simple } as const;

export const getAttachmentOp = defineOperationContract({
  ...common,
  id: 'attachments.get',
  title: 'op.attachments.get',
  description: 'An attachment: its name, size and where it came from',
  input: byId,
  output: attachmentSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/attachments/:id' },
});

export const removeAttachmentOp = defineOperationContract({
  ...common,
  id: 'attachments.remove',
  title: 'op.attachments.remove',
  description: 'Remove an attachment that was not sent yet',
  input: byId,
  output: z.void(),
  risk: OperationRisk.Write,
  http: { method: 'DELETE', path: '/attachments/:id' },
});

export const snapshotProjectFileOp = defineOperationContract({
  ...common,
  id: 'attachments.snapshotProjectFile',
  title: 'op.attachments.snapshotProjectFile',
  description: "Save a file of a project, or of a task's worktree, as an attachment",
  input: snapshotProjectFileSchema,
  output: attachmentSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/attachments/project-file', status: 201 },
});

export const previewAttachmentSheetOp = defineOperationContract({
  ...common,
  id: 'attachments.previewSheet',
  title: 'op.attachments.previewSheet',
  description: "One sheet of an Excel attachment's preview: its first rows",
  input: z.object({ id: z.string(), sheet: z.string().min(1) }),
  output: sheetPreviewSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/attachments/:id/sheet' },
});
