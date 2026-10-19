import {
  AppError,
  type AttemptDTO,
  type AttemptEvent,
  type AttemptSummaryDTO,
  attemptMachine,
  ErrorCode,
  type ErrorInfo,
  isTerminalState,
  ServerEventType,
  TranscriptEntryKind,
  type TranscriptSystemEvent,
  transition,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { EventBus } from '../../core/event-bus.ts';
import type { Logger } from '../../core/logger.ts';
import type { ModelRef, OpencodeClient } from '../opencode/index.ts';
import { type Attempt, createAttemptsRepo } from './attempts.repo.ts';
import type { SessionView } from './attempts.session-view.ts';
import type { NewTranscriptEntry, TranscriptStore } from './attempts.transcript.ts';

/** In-memory state of a session we created, kept until it goes quiet so trailing events still reach the transcript. */
export type LiveSession = {
  attemptId: string;
  taskId: string | null;
  sessionId: string;
  directory: string;
  agent: string;
  model: ModelRef | undefined;
  system: string | undefined;
  view: SessionView;
  cancelTimeout: () => void;
  /** Set once the result was submitted: further generation is stopped when the submit call completes (12 §4.2). */
  stopAfterSubmit: boolean;
};

export type AttemptStateDeps = {
  db: Db;
  events: EventBus;
  clock: Clock;
  log: Logger;
  opencode: OpencodeClient;
  transcripts: TranscriptStore;
};

/** An expected failure (opencode request, not ready …) as the error recorded on the attempt; anything else is a bug. */
export function errorOf(err: unknown): ErrorInfo {
  if (err instanceof AppError) return err.toInfo();
  throw err;
}

export const systemEntry = (event: TranscriptSystemEvent): NewTranscriptEntry => ({
  kind: TranscriptEntryKind.System,
  data: { event },
});

/** What the attempt service and its session reactions share: records, live sessions and the transition helper. */
export function createAttemptState({ db, events, clock, log, opencode, transcripts }: AttemptStateDeps) {
  const repo = createAttemptsRepo(db);
  /** By opencode session id. */
  const live = new Map<string, LiveSession>();
  /** `report_progress` lines of active attempts (D41). */
  const progress = new Map<string, string>();

  function mustFind(id: string): Attempt {
    const attempt = repo.find(id);
    if (attempt === undefined) throw new AppError(ErrorCode.AttemptNotFound, `No attempt ${id}`, { id });
    return attempt;
  }

  function toSummary({
    directory: _d,
    opencodeSessionId: _s,
    tokensInput: _i,
    tokensOutput: _o,
    cost: _c,
    ...a
  }: Attempt) {
    return { ...a, progress: progress.get(a.id) ?? null } satisfies AttemptSummaryDTO;
  }

  function publish(attempt: Attempt): void {
    events.publish({
      type: ServerEventType.AttemptUpdated,
      data: { taskId: attempt.taskId, nodeId: attempt.nodeId, attempt: toSummary(attempt) },
    });
  }

  const sessionOf = (attemptId: string) => [...live.values()].find((s) => s.attemptId === attemptId);

  return {
    repo,
    live,
    progress,
    mustFind,
    publish,
    sessionOf,
    toDto: (attempt: Attempt): AttemptDTO => ({ ...attempt, progress: progress.get(attempt.id) ?? null }),

    record(attempt: { id: string; taskId: string | null }, entries: NewTranscriptEntry[]): void {
      transcripts.append(attempt, entries);
    },

    /** Applies a state-machine event; terminal states end the attempt, its progress line and its timeout. */
    move(attempt: Attempt, event: AttemptEvent, error?: ErrorInfo): Attempt {
      const to = transition(attemptMachine, attempt.status, event);
      const ended = isTerminalState(attemptMachine, to);
      repo.updateStatus(attempt.id, attempt.status, to, {
        ...(ended ? { endedAt: clock.now() } : {}),
        ...(error === undefined ? {} : { error }),
      });
      if (ended) {
        progress.delete(attempt.id);
        sessionOf(attempt.id)?.cancelTimeout();
      }
      const updated = mustFind(attempt.id);
      log.info({ attemptId: attempt.id, from: attempt.status, to, event }, 'attempt transition');
      publish(updated);
      return updated;
    },

    /** Sends a message to the session and records it as ours. */
    async send(session: LiveSession, text: string): Promise<void> {
      transcripts.append({ id: session.attemptId, taskId: session.taskId }, [
        { kind: TranscriptEntryKind.UserMessage, data: { text } },
      ]);
      await opencode.prompt({
        sessionId: session.sessionId,
        directory: session.directory,
        agent: session.agent,
        ...(session.model === undefined ? {} : { model: session.model }),
        ...(session.system === undefined ? {} : { system: session.system }),
        text,
      });
    },

    stopSession: (session: LiveSession) =>
      opencode.abort({ sessionId: session.sessionId, directory: session.directory }),

    /** Background reactions to events have no caller; an unexpected failure is logged with the attempt. */
    inBackground(attemptId: string, work: () => Promise<void>): void {
      work().catch((err: unknown) => log.error({ err, attemptId }, 'attempt background work failed'));
    },
  };
}
export type AttemptState = ReturnType<typeof createAttemptState>;
