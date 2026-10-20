import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { EventBus } from '../../core/event-bus.ts';
import { attemptOperations } from './attempts.operations.ts';
import { registerAttemptRoutes } from './attempts.routes.ts';
import { type AttemptsServiceDeps, createAttemptsService } from './attempts.service.ts';
import { createTranscriptStore } from './attempts.transcript.ts';

export type { Attempt } from './attempts.repo.ts';
export type { AttemptSignal, AttemptsService, ResumeInput, StartAttemptInput } from './attempts.service.ts';

export function createAttemptsModule(
  deps: Omit<AttemptsServiceDeps, 'transcripts'> & { dataDir: string; events: EventBus },
) {
  const transcripts = createTranscriptStore({
    runsDir: join(deps.dataDir, 'runs'),
    events: deps.events,
    clock: deps.clock,
  });
  const service = createAttemptsService({ ...deps, transcripts });
  return {
    service,
    operations: attemptOperations(service),
    registerRoutes: (server: FastifyInstance) => registerAttemptRoutes(server, service),
  };
}
