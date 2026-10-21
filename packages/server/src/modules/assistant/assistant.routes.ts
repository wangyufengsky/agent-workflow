import { API_PREFIX, type TranscriptPage, transcriptQuerySchema } from '@aw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../../core/http/errors.ts';
import type { AssistantService } from './assistant.service.ts';

/** The message stream is a growing log read page by page, like an attempt's transcript (03 §5). */
export function registerAssistantRoutes(server: FastifyInstance, conversations: AssistantService): void {
  server.get(`${API_PREFIX}/assistant/conversations/:id/transcript`, async (req): Promise<TranscriptPage> => {
    const { id } = parseInput(z.object({ id: z.string() }), req.params);
    const { afterSeq } = parseInput(transcriptQuerySchema, req.query);
    return conversations.transcript(id, afterSeq);
  });
}
