import { getAttachmentOp, removeAttachmentOp, snapshotProjectFileOp } from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { AttachmentsService } from './attachments.service.ts';

export function attachmentOperations(attachments: AttachmentsService) {
  return [
    implement(getAttachmentOp, ({ id }) => attachments.get(id)),
    implement(removeAttachmentOp, ({ id }) => attachments.remove(id)),
    implement(snapshotProjectFileOp, (input) => attachments.snapshotProjectFile(input)),
  ];
}
