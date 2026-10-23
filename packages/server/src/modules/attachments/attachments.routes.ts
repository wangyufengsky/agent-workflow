import { createReadStream } from 'node:fs';
import {
  API_PREFIX,
  AppError,
  ATTACHMENT_NAME_HEADER,
  type AttachmentDTO,
  attachmentNameSchema,
  ErrorCode,
} from '@aw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../../core/http/errors.ts';
import type { AttachmentsService } from './attachments.service.ts';

const OCTET_STREAM = 'application/octet-stream';

/** The display name travels URL-encoded in a header, so any file name fits. */
function nameOf(header: unknown): string {
  const encoded = parseInput(z.string(), header);
  let name: string;
  try {
    name = decodeURIComponent(encoded);
  } catch {
    throw new AppError(ErrorCode.ValidationFailed, 'Malformed attachment name', { header: ATTACHMENT_NAME_HEADER });
  }
  return parseInput(attachmentNameSchema, name);
}

/**
 * Binary bodies are not operations (03 §5, 11 §14.1): the upload is checked byte for byte (30 §3.1), and the
 * original is read as it was stored. Both take the renderer token like every `/api/v1` route.
 */
export function registerAttachmentRoutes(server: FastifyInstance, attachments: AttachmentsService): void {
  // Encapsulated: the raw body parser applies to these routes only. The service enforces the size limit itself.
  void server.register(async (scope) => {
    // The handler reads the request stream itself.
    scope.addContentTypeParser(OCTET_STREAM, (_req, _payload, done) => done(null));

    scope.post(`${API_PREFIX}/attachments`, async (req, reply): Promise<AttachmentDTO> => {
      const length = req.headers['content-length'];
      const attachment = await attachments.upload(
        nameOf(req.headers[ATTACHMENT_NAME_HEADER]),
        req.raw,
        length === undefined ? undefined : Number(length),
      );
      return reply.code(201).send(attachment);
    });

    scope.get(`${API_PREFIX}/attachments/:id/content`, async (req, reply) => {
      const { id } = parseInput(z.object({ id: z.string() }), req.params);
      // Plain text that the browser must not reinterpret as HTML or script.
      return reply
        .type('text/plain; charset=utf-8')
        .header('x-content-type-options', 'nosniff')
        .send(createReadStream(attachments.contentPath(id)));
    });
  });
}
