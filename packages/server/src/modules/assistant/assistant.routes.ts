import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { API_PREFIX, type TranscriptPage, transcriptQuerySchema } from '@aw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../../core/http/errors.ts';
import type { AssistantService } from './assistant.service.ts';

/**
 * The message stream is a growing log read page by page, like an attempt's transcript (03 §5). A file the assistant
 * wrote is bytes to save, not an operation's JSON (39 §8.2).
 */
export function registerAssistantRoutes(server: FastifyInstance, conversations: AssistantService): void {
  server.get(`${API_PREFIX}/assistant/conversations/:id/transcript`, async (req): Promise<TranscriptPage> => {
    const { id } = parseInput(z.object({ id: z.string() }), req.params);
    const { afterSeq } = parseInput(transcriptQuerySchema, req.query);
    return conversations.transcript(id, afterSeq);
  });

  server.get(`${API_PREFIX}/assistant/conversations/:id/files/raw`, async (req, reply) => {
    const { id } = parseInput(z.object({ id: z.string() }), req.params);
    const { path } = parseInput(z.object({ path: z.string().min(1) }), req.query);
    const file = conversations.fileOf(id, path);
    return reply
      .type('application/octet-stream')
      .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(basename(file))}`)
      .header('x-content-type-options', 'nosniff')
      .send(createReadStream(file));
  });
}
