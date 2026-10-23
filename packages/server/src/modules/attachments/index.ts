import type { FastifyInstance } from 'fastify';
import { attachmentOperations } from './attachments.operations.ts';
import { registerAttachmentRoutes } from './attachments.routes.ts';
import { type AttachmentsServiceDeps, createAttachmentsService } from './attachments.service.ts';

export type { Owner as AttachmentOwner } from './attachments.repo.ts';
export type { AttachmentsService } from './attachments.service.ts';
export { attachmentRefsTable, attachmentsTable } from './attachments.table.ts';

export function createAttachmentsModule(deps: AttachmentsServiceDeps) {
  const service = createAttachmentsService(deps);
  return {
    service,
    operations: attachmentOperations(service),
    registerRoutes: (server: FastifyInstance) => registerAttachmentRoutes(server, service),
  };
}
