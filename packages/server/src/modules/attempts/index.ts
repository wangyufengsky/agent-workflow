import { join } from 'node:path';
import { ServerEventType } from '@aw/shared';
import type { FastifyInstance } from 'fastify';
import type { EventBus } from '../../core/event-bus.ts';
import { attemptOperations } from './attempts.operations.ts';
import { registerAttemptRoutes } from './attempts.routes.ts';
import { type AttemptsServiceDeps, createAttemptsService } from './attempts.service.ts';
import { createTranscriptStore } from './attempts.transcript.ts';

export type { Attempt } from './attempts.repo.ts';
export { createSessionView, type SessionView } from './attempts.session-view.ts';
export { createTranscriptStore, type NewTranscriptEntry, type TranscriptStore } from './attempts.transcript.ts';

const DEBUG_RUN_DIR = 'debug';

export type { AttemptSignal, AttemptsService, ResumeInput, StartAttemptInput } from './attempts.service.ts';

export function createAttemptsModule(
  deps: Omit<AttemptsServiceDeps, 'transcripts'> & { dataDir: string; events: EventBus },
) {
  const runsDir = join(deps.dataDir, 'runs');
  const transcripts = createTranscriptStore<{ id: string; taskId: string | null }>({
    // Debug attempts belong to no task; their transcripts live under `runs/debug/`.
    fileOf: (attempt) => join(runsDir, attempt.taskId ?? DEBUG_RUN_DIR, `${attempt.id}.jsonl`),
    onAppend: (attempt, entries) =>
      deps.events.publish({ type: ServerEventType.AttemptTranscript, data: { attemptId: attempt.id, entries } }),
    clock: deps.clock,
  });
  const service = createAttemptsService({ ...deps, transcripts });
  return {
    service,
    operations: attemptOperations(service),
    registerRoutes: (server: FastifyInstance) => registerAttemptRoutes(server, service),
  };
}
