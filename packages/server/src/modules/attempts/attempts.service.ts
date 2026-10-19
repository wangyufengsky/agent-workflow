import { randomUUID } from 'node:crypto';
import { PromptName, type Prompts, renderTemplate } from '@aw/builtin';
import {
  AppError,
  ATTEMPT_BASE_AGENT,
  ATTEMPT_MAX_NUDGES,
  ATTEMPT_SUBMIT_TOOL,
  type AttemptDTO,
  AttemptEvent,
  type AttemptKind,
  AttemptStatus,
  type AttemptSummaryDTO,
  attemptMachine,
  ErrorCode,
  type ErrorInfo,
  isTerminalState,
  MCP_TOOL_PREFIX,
  OPENCODE_AGENT_NAME,
  ServerEventType,
  TranscriptEntryKind,
  type TranscriptPage,
  TranscriptSystemEvent,
  transition,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { EventBus } from '../../core/event-bus.ts';
import type { Logger } from '../../core/logger.ts';
import {
  type ModelRef,
  type OpencodeClient,
  type OpencodeEvent,
  OpencodeEventType,
  parseModelRef,
  sessionPermissionRules,
  ToolCallStatus,
} from '../opencode/index.ts';
import type { SettingsService } from '../settings/index.ts';
import { type Attempt, createAttemptsRepo } from './attempts.repo.ts';
import { createSessionView, type SessionView } from './attempts.session-view.ts';
import type { NewTranscriptEntry, TranscriptStore } from './attempts.transcript.ts';

export type AttemptsServiceDeps = {
  db: Db;
  events: EventBus;
  clock: Clock;
  log: Logger;
  opencode: OpencodeClient;
  settings: SettingsService;
  transcripts: TranscriptStore;
  prompts: Prompts;
};

export type StartAttemptInput = {
  kind: AttemptKind;
  taskId: string | null;
  nodeId: string | null;
  roleId: string | null;
  /** Session working directory: the task worktree. */
  directory: string;
  /** Session title, `<taskKey> · <node title>` (12 §4.1). */
  title: string;
  /** `provider/model`; null lets opencode pick its default. */
  model: string | null;
  /** Role prompt appended to the agent prompt (12 §2). */
  system?: string;
  /** First message. */
  prompt: string;
};

/** In-memory state of a session we created, kept until it goes quiet so trailing events still reach the transcript. */
type LiveSession = {
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

const ACTIVE: readonly AttemptStatus[] = [AttemptStatus.Starting, AttemptStatus.Running];

function errorOf(err: unknown): ErrorInfo {
  if (err instanceof AppError) return err.toInfo();
  throw err;
}

/** Attempt lifecycle (09 §4) and the session protocol's end conditions (12 §4.2). */
export function createAttemptsService(deps: AttemptsServiceDeps) {
  const { db, events, clock, log, opencode, transcripts } = deps;
  const repo = createAttemptsRepo(db);
  const live = new Map<string, LiveSession>();
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

  function toDto(attempt: Attempt): AttemptDTO {
    return { ...attempt, progress: progress.get(attempt.id) ?? null };
  }

  function publish(attempt: Attempt): void {
    events.publish({
      type: ServerEventType.AttemptUpdated,
      data: { taskId: attempt.taskId, nodeId: attempt.nodeId, attempt: toSummary(attempt) },
    });
  }

  function record(attempt: { id: string; taskId: string | null }, entries: NewTranscriptEntry[]): void {
    transcripts.append(attempt, entries);
  }

  const systemEntry = (event: TranscriptSystemEvent): NewTranscriptEntry => ({
    kind: TranscriptEntryKind.System,
    data: { event },
  });

  /** Applies a state-machine event; terminal states end the attempt and its timeout. */
  function move(attempt: Attempt, event: AttemptEvent, error?: ErrorInfo): Attempt {
    const to = transition(attemptMachine, attempt.status, event);
    const ended = isTerminalState(attemptMachine, to);
    repo.updateStatus(attempt.id, attempt.status, to, {
      ...(ended ? { endedAt: clock.now() } : {}),
      ...(error === undefined ? {} : { error }),
    });
    if (ended) {
      progress.delete(attempt.id);
      for (const session of live.values()) if (session.attemptId === attempt.id) session.cancelTimeout();
    }
    const updated = mustFind(attempt.id);
    log.info({ attemptId: attempt.id, from: attempt.status, to, event }, 'attempt transition');
    publish(updated);
    return updated;
  }

  async function send(session: LiveSession, text: string): Promise<void> {
    record({ id: session.attemptId, taskId: session.taskId }, [
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
  }

  async function stopSession(session: LiveSession): Promise<void> {
    await opencode.abort({ sessionId: session.sessionId, directory: session.directory });
  }

  /** Background reactions to events have no caller; an unexpected failure is logged with the attempt. */
  function inBackground(attemptId: string, work: () => Promise<void>): void {
    work().catch((err: unknown) => log.error({ err, attemptId }, 'attempt background work failed'));
  }

  function timeOut(attemptId: string): void {
    const attempt = mustFind(attemptId);
    if (attempt.status !== AttemptStatus.Running) return;
    record(attempt, [systemEntry(TranscriptSystemEvent.TimedOut)]);
    move(attempt, AttemptEvent.Timeout, { code: ErrorCode.AttemptTimeout, message: 'Attempt timed out' });
    const session = [...live.values()].find((s) => s.attemptId === attemptId);
    if (session !== undefined) inBackground(attemptId, () => stopSession(session));
  }

  /** Idle without a submitted result: nudge once, then give up (12 §4.2). */
  async function onIdle(attempt: Attempt, session: LiveSession): Promise<void> {
    // TODO(M3-08): idle with an open blocking question moves the node to waiting_input instead.
    if (attempt.nudges >= ATTEMPT_MAX_NUDGES) {
      move(attempt, AttemptEvent.NoResult, {
        code: ErrorCode.AttemptNoResult,
        message: 'Session went idle without submitting a result',
      });
      return;
    }
    repo.incrementNudges(attempt.id);
    publish(mustFind(attempt.id));
    record(attempt, [systemEntry(TranscriptSystemEvent.Nudged)]);
    const nudge = renderTemplate(deps.prompts[PromptName.Nudge], { submitTool: ATTEMPT_SUBMIT_TOOL[attempt.kind] });
    try {
      await send(session, nudge);
    } catch (err) {
      const current = mustFind(attempt.id);
      if (current.status === AttemptStatus.Running) move(current, AttemptEvent.SessionError, errorOf(err));
    }
  }

  function onEvent(event: OpencodeEvent): void {
    if (event.type === OpencodeEventType.RuntimeLost) {
      interruptActive();
      return;
    }
    const session = live.get(event.sessionId);
    if (session === undefined) return;
    const attempt = mustFind(session.attemptId);
    const running = attempt.status === AttemptStatus.Running;
    // Errors after the attempt ended (e.g. the abort we sent after a submit) are not the attempt's.
    if (running || event.type !== OpencodeEventType.Error) record(attempt, session.view.toEntries(event));
    switch (event.type) {
      case OpencodeEventType.StepFinished:
        repo.addUsage(attempt.id, { ...event.tokens, cost: event.cost });
        return;
      case OpencodeEventType.Idle:
        if (running) inBackground(attempt.id, () => onIdle(attempt, session));
        else live.delete(session.sessionId);
        return;
      case OpencodeEventType.Error:
        if (running) {
          move(attempt, AttemptEvent.SessionError, {
            code: ErrorCode.AttemptSessionError,
            message: event.error?.name ?? 'session error',
            ...(event.error === undefined ? {} : { details: { error: event.error } }),
          });
        }
        return;
      case OpencodeEventType.Tool: {
        const isSubmit = event.tool === `${MCP_TOOL_PREFIX}${ATTEMPT_SUBMIT_TOOL[attempt.kind]}`;
        const finished = event.status === ToolCallStatus.Completed || event.status === ToolCallStatus.Error;
        if (session.stopAfterSubmit && isSubmit && finished) {
          session.stopAfterSubmit = false;
          inBackground(attempt.id, () => stopSession(session));
        }
        return;
      }
      default:
        return;
    }
  }

  function interruptActive(): void {
    for (const attempt of repo.listByStatus(ACTIVE)) {
      record(attempt, [systemEntry(TranscriptSystemEvent.RuntimeLost)]);
      move(attempt, AttemptEvent.RuntimeLost);
    }
    for (const session of live.values()) session.cancelTimeout();
    live.clear();
  }

  opencode.subscribe(onEvent);

  return {
    get(id: string): AttemptDTO {
      return toDto(mustFind(id));
    },

    /** Creates the session and sends the first message (12 §4.1); the attempt is then `running`. */
    async start(input: StartAttemptInput): Promise<AttemptDTO> {
      if (!opencode.isConnected()) throw new AppError(ErrorCode.OpencodeNotReady, 'opencode is not ready');
      const model = input.model === null ? undefined : parseModelRef(input.model);
      const id = randomUUID();
      repo.insert({
        id,
        taskId: input.taskId,
        nodeId: input.nodeId,
        roleId: input.roleId,
        kind: input.kind,
        seq: repo.nextSeq(input),
        status: AttemptStatus.Starting,
        model: input.model,
        directory: input.directory,
        nudges: 0,
        startedAt: clock.now(),
      });
      let attempt = mustFind(id);
      publish(attempt);
      record(attempt, [systemEntry(TranscriptSystemEvent.AttemptStarted)]);

      const base = ATTEMPT_BASE_AGENT[input.kind];
      const agent = OPENCODE_AGENT_NAME[base];
      let sessionId: string;
      try {
        sessionId = await opencode.createSession({
          directory: input.directory,
          title: input.title,
          agent,
          permission: sessionPermissionRules(base, deps.settings.get('ai.bashPolicy')),
        });
      } catch (err) {
        return toDto(move(mustFind(id), AttemptEvent.StartFailed, errorOf(err)));
      }
      repo.setSession(id, sessionId);
      attempt = mustFind(id);
      // The runtime may have gone away while the session was being created.
      if (attempt.status !== AttemptStatus.Starting) return toDto(attempt);

      const timeoutMs = deps.settings.get('attempt.timeoutMinutes') * 60_000;
      const session: LiveSession = {
        attemptId: id,
        taskId: input.taskId,
        sessionId,
        directory: input.directory,
        agent,
        model,
        system: input.system,
        view: createSessionView(),
        cancelTimeout: clock.schedule(timeoutMs, () => timeOut(id)),
        stopAfterSubmit: false,
      };
      live.set(sessionId, session);
      // Running before the first prompt, so every event of the session finds the attempt active.
      attempt = move(attempt, AttemptEvent.SessionStarted);
      try {
        await send(session, input.prompt);
      } catch (err) {
        const current = mustFind(id);
        if (current.status === AttemptStatus.Running) move(current, AttemptEvent.SessionError, errorOf(err));
      }
      return toDto(mustFind(id));
    },

    /** The latest attempt on an opencode session; MCP calls are attributed by it (12 §3). */
    findLatestBySession(sessionId: string): AttemptDTO | undefined {
      const attempt = repo.findLatestBySession(sessionId);
      return attempt === undefined ? undefined : toDto(attempt);
    },

    /** `submit_*` succeeded: the attempt is done; further generation is stopped once the call returns. */
    markSubmitted(id: string): AttemptDTO {
      const attempt = mustFind(id);
      record(attempt, [systemEntry(TranscriptSystemEvent.ResultSubmitted)]);
      const updated = move(attempt, AttemptEvent.Submitted);
      for (const session of live.values()) if (session.attemptId === id) session.stopAfterSubmit = true;
      return toDto(updated);
    },

    /** User abort (11 §6). */
    async abort(id: string): Promise<AttemptDTO> {
      const attempt = mustFind(id);
      record(attempt, [systemEntry(TranscriptSystemEvent.Aborted)]);
      const updated = move(attempt, AttemptEvent.Abort);
      const session = [...live.values()].find((s) => s.attemptId === id);
      if (session !== undefined) await stopSession(session);
      return toDto(updated);
    },

    /** `report_progress` (12 §6.8): one line kept in memory and pushed to the renderer. */
    reportProgress(id: string, message: string): void {
      progress.set(id, message);
      publish(mustFind(id));
    },

    transcript(id: string, afterSeq: number): TranscriptPage {
      const attempt = mustFind(id);
      return transcripts.read(attempt, afterSeq, isTerminalState(attemptMachine, attempt.status));
    },

    listDebug(limit: number): AttemptDTO[] {
      return repo.listDebug(limit).map(toDto);
    },

    /** Startup: sessions of a previous run are gone, so attempts still active then are interrupted (03 §2.1). */
    recover(): void {
      interruptActive();
    },
  };
}
export type AttemptsService = ReturnType<typeof createAttemptsService>;
