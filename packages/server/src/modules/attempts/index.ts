import { join } from 'node:path';
import { AttemptKind, ServerEventType } from '@aw/shared';
import type { FastifyInstance } from 'fastify';
import type { EventBus } from '../../core/event-bus.ts';
import { attemptOperations } from './attempts.operations.ts';
import { registerAttemptRoutes } from './attempts.routes.ts';
import { type AttemptsServiceDeps, createAttemptsService } from './attempts.service.ts';
import { createTranscriptStore } from './attempts.transcript.ts';

export type { Attempt } from './attempts.repo.ts';
export { createSessionView, type SessionView } from './attempts.session-view.ts';
export { attemptsTable } from './attempts.table.ts';
export { createTranscriptStore, type NewTranscriptEntry, type TranscriptStore } from './attempts.transcript.ts';

const DEBUG_RUN_DIR = 'debug';
const KNOWLEDGE_RUN_DIR = 'knowledge';
const PPT_RUN_DIR = 'ppt';
const GIT_RUN_DIR = 'git';

/** Where the transcript of an attempt that belongs to no task lives. */
function runDirOf(kind: AttemptKind): string {
  if (kind === AttemptKind.Research) return KNOWLEDGE_RUN_DIR;
  if (kind === AttemptKind.DeckOutline || kind === AttemptKind.DeckSlides) return PPT_RUN_DIR;
  if (kind === AttemptKind.GitReview || kind === AttemptKind.CommitMessage) return GIT_RUN_DIR;
  return DEBUG_RUN_DIR;
}

export type { AttemptSignal, AttemptsService, ResumeInput, StartAttemptInput } from './attempts.service.ts';

export function createAttemptsModule(
  deps: Omit<AttemptsServiceDeps, 'transcripts'> & { dataDir: string; events: EventBus },
) {
  const runsDir = join(deps.dataDir, 'runs');
  const transcripts = createTranscriptStore<{ id: string; taskId: string | null; kind: AttemptKind }>({
    // Research, PPT, Git workbench and debug attempts belong to no task; their transcripts live under
    // `runs/knowledge/`, `runs/ppt/`, `runs/git/` and `runs/debug/`.
    fileOf: (attempt) => join(runsDir, attempt.taskId ?? runDirOf(attempt.kind), `${attempt.id}.jsonl`),
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
