import { API_PREFIX, type TranscriptPage, transcriptQuerySchema } from '@aw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../../core/http/errors.ts';
import type { AttemptsService } from './attempts.service.ts';

/** The transcript is a growing log read page by page, not a one-shot operation (03 §5). */
export function registerAttemptRoutes(server: FastifyInstance, attempts: AttemptsService): void {
  server.get(`${API_PREFIX}/attempts/:id/transcript`, async (req): Promise<TranscriptPage> => {
    const { id } = parseInput(z.object({ id: z.string() }), req.params);
    const { afterSeq } = parseInput(transcriptQuerySchema, req.query);
    return attempts.transcript(id, afterSeq);
  });
}
