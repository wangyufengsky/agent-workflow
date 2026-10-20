import {
  AppError,
  type AttemptDTO,
  type AttemptEvent,
  type AttemptSummaryDTO,
  attemptMachine,
  ErrorCode,
  type ErrorInfo,
  InboxKind,
  isTerminalState,
  ServerEventType,
  TaskEventEntity,
  TranscriptEntryKind,
  TranscriptSystemEvent,
  transition,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { Logger } from '../../core/logger.ts';
import type { InboxService } from '../inbox/index.ts';
import type { ModelRef, OpencodeClient } from '../opencode/index.ts';
import { recordTaskEvent } from '../timeline/index.ts';
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
  timeoutMs: number;
  cancelTimeout: () => void;
  /** Set once the result was submitted: further generation is stopped when the submit call completes (12 §4.2). */
  stopAfterSubmit: boolean;
  /** Waiting for the user (blocking question or permission); the timeout does not run meanwhile. */
  parked: boolean;
  /** The last turn ended and no message was sent since. */
  idle: boolean;
  /** Answers to send at the next opportunity (the session was busy, or other questions are still open). */
  pendingAnswers: string[];
  /** Resolves once we stop following the session (its last turn went idle, or the runtime was lost). */
  released: Promise<void>;
  release: () => void;
};

/**
 * What the owner of an attempt (a node, a plan, an acceptance review) needs to hear about: the attempt ended (in any
 * terminal state), or its session started or stopped waiting for the user.
 */
export type AttemptSignal = { type: 'ended' | 'awaiting_input' | 'input_answered'; attempt: Attempt };

export type AttemptStateDeps = {
  db: Db;
  unit: UnitOfWork;
  clock: Clock;
  log: Logger;
  opencode: OpencodeClient;
  inbox: InboxService;
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
export function createAttemptState({ db, unit, clock, log, opencode, inbox, transcripts }: AttemptStateDeps) {
  const repo = createAttemptsRepo(db);
  /** By opencode session id. */
  const live = new Map<string, LiveSession>();
  /** `report_progress` lines of active attempts (D41). */
  const progress = new Map<string, string>();
  const listeners = new Set<(signal: AttemptSignal) => void>();

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
    roleId: _r,
    ...a
  }: Attempt): AttemptSummaryDTO {
    return { ...a, progress: progress.get(a.id) ?? null };
  }

  function publish(attempt: Attempt): void {
    unit.publish({
      type: ServerEventType.AttemptUpdated,
      data: { taskId: attempt.taskId, nodeId: attempt.nodeId, attempt: toSummary(attempt) },
    });
  }

  /** Owners react synchronously once the change committed; a failing reaction has no caller to report to. */
  function signal(type: AttemptSignal['type'], attempt: Attempt): void {
    unit.afterCommit(() => {
      for (const listener of listeners) {
        try {
          listener({ type, attempt });
        } catch (err) {
          log.error({ err, attemptId: attempt.id, signal: type }, 'attempt signal handler failed');
        }
      }
    });
  }

  const sessionOf = (attemptId: string) => [...live.values()].find((s) => s.attemptId === attemptId);

  /** Stops following a session: later events of it are ignored until a new attempt tracks it. */
  function releaseSession(session: LiveSession): void {
    if (live.get(session.sessionId) === session) live.delete(session.sessionId);
    session.release();
  }

  /** An open blocking question or a pending permission request of the attempt: the session waits for the user. */
  function waitsForUser(attemptId: string): boolean {
    return inbox
      .listOpen({ attemptId })
      .some(
        (item) => item.kind === InboxKind.Permission || (item.kind === InboxKind.Question && item.payload.blocking),
      );
  }

  /** Only an open blocking question survives a lost runtime: the session is persisted, a permission request is not. */
  function waitsForAnswer(attemptId: string): boolean {
    return inbox
      .listOpen({ attemptId, kind: InboxKind.Question })
      .some((item) => item.kind === InboxKind.Question && item.payload.blocking);
  }

  return {
    repo,
    inbox,
    live,
    progress,
    mustFind,
    publish,
    signal,
    sessionOf,
    releaseSession,
    waitsForUser,
    waitsForAnswer,
    toSummary,
    toDto: (attempt: Attempt): AttemptDTO => {
      const { roleId: _roleId, ...rest } = attempt;
      return { ...rest, progress: progress.get(attempt.id) ?? null };
    },
    onSignal(listener: (signal: AttemptSignal) => void): void {
      listeners.add(listener);
    },

    record(attempt: { id: string; taskId: string | null }, entries: NewTranscriptEntry[]): void {
      transcripts.append(attempt, entries);
    },

    /**
     * Applies a state-machine event with its task event; terminal states end the attempt's progress line, timeout and
     * open inbox items, and tell its owner.
     */
    move(attempt: Attempt, event: AttemptEvent, error?: ErrorInfo): Attempt {
      const to = transition(attemptMachine, attempt.status, event);
      const ended = isTerminalState(attemptMachine, to);
      const now = clock.now();
      const updated = unit.transact(() => {
        repo.updateStatus(attempt.id, attempt.status, to, {
          ...(ended ? { endedAt: now } : {}),
          ...(error === undefined ? {} : { error }),
        });
        if (attempt.taskId !== null) {
          recordTaskEvent(db, {
            taskId: attempt.taskId,
            entity: TaskEventEntity.Attempt,
            entityId: attempt.id,
            type: event,
            fromStatus: attempt.status,
            toStatus: to,
            ...(error === undefined ? {} : { payload: { error } }),
            createdAt: now,
          });
        }
        if (ended) inbox.dismissOpen({ attemptId: attempt.id });
        return mustFind(attempt.id);
      });
      if (ended) {
        progress.delete(attempt.id);
        const session = sessionOf(attempt.id);
        session?.cancelTimeout();
        if (session !== undefined) session.parked = false;
      }
      log.info({ attemptId: attempt.id, from: attempt.status, to, event }, 'attempt transition');
      publish(updated);
      if (ended) signal('ended', updated);
      return updated;
    },

    /** The session waits for the user: its timeout stops until the input arrives. */
    park(session: LiveSession, attempt: Attempt): void {
      if (session.parked) return;
      session.parked = true;
      session.cancelTimeout();
      transcripts.append(attempt, [systemEntry(TranscriptSystemEvent.AwaitingInput)]);
      signal('awaiting_input', attempt);
    },

    /** Sends a message to the session and records it as ours. */
    async send(session: LiveSession, text: string): Promise<void> {
      session.idle = false;
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
