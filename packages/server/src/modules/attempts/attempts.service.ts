import { randomUUID } from 'node:crypto';
import type { Prompts } from '@aw/builtin';
import {
  AppError,
  ATTEMPT_BASE_AGENT,
  type AttemptDTO,
  AttemptEvent,
  type AttemptKind,
  AttemptStatus,
  attemptMachine,
  ErrorCode,
  isTerminalState,
  OPENCODE_AGENT_NAME,
  type TranscriptPage,
  TranscriptSystemEvent,
} from '@aw/shared';
import { parseModelRef, sessionPermissionRules } from '../opencode/index.ts';
import type { SettingsService } from '../settings/index.ts';
import { watchSessions } from './attempts.reactions.ts';
import { createSessionView } from './attempts.session-view.ts';
import { type AttemptStateDeps, createAttemptState, errorOf, type LiveSession, systemEntry } from './attempts.state.ts';

export type AttemptsServiceDeps = AttemptStateDeps & { settings: SettingsService; prompts: Prompts };

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

/** Attempt lifecycle (09 §4) and the session protocol (12 §4); opencode-driven end conditions are in the reactions. */
export function createAttemptsService(deps: AttemptsServiceDeps) {
  const { clock, opencode, settings, transcripts } = deps;
  const state = createAttemptState(deps);
  const { repo, mustFind, move, record, toDto } = state;
  const reactions = watchSessions(state, deps);

  return {
    get: (id: string): AttemptDTO => toDto(mustFind(id)),

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
      state.publish(mustFind(id));
      record(mustFind(id), [systemEntry(TranscriptSystemEvent.AttemptStarted)]);

      const base = ATTEMPT_BASE_AGENT[input.kind];
      const agent = OPENCODE_AGENT_NAME[base];
      let sessionId: string;
      try {
        sessionId = await opencode.createSession({
          directory: input.directory,
          title: input.title,
          agent,
          permission: sessionPermissionRules(base, settings.get('ai.bashPolicy')),
        });
      } catch (err) {
        return toDto(move(mustFind(id), AttemptEvent.StartFailed, errorOf(err)));
      }
      repo.setSession(id, sessionId);
      const attempt = mustFind(id);
      // The runtime may have gone away while the session was being created.
      if (attempt.status !== AttemptStatus.Starting) return toDto(attempt);

      const session: LiveSession = {
        attemptId: id,
        taskId: input.taskId,
        sessionId,
        directory: input.directory,
        agent,
        model,
        system: input.system,
        view: createSessionView(),
        cancelTimeout: clock.schedule(settings.get('attempt.timeoutMinutes') * 60_000, () => reactions.timeOut(id)),
        stopAfterSubmit: false,
      };
      state.live.set(sessionId, session);
      // Running before the first prompt, so every event of the session finds the attempt active.
      move(attempt, AttemptEvent.SessionStarted);
      try {
        await state.send(session, input.prompt);
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
      const updated = move(mustFind(id), AttemptEvent.Submitted);
      const session = state.sessionOf(id);
      if (session !== undefined) session.stopAfterSubmit = true;
      return toDto(updated);
    },

    /** User abort (11 §6). */
    async abort(id: string): Promise<AttemptDTO> {
      const updated = move(mustFind(id), AttemptEvent.Abort);
      record(updated, [systemEntry(TranscriptSystemEvent.Aborted)]);
      const session = state.sessionOf(id);
      if (session !== undefined) await state.stopSession(session);
      return toDto(updated);
    },

    /** `report_progress` (12 §6.8): one line kept in memory and pushed to the renderer (D41). */
    reportProgress(id: string, message: string): void {
      state.progress.set(id, message);
      state.publish(mustFind(id));
    },

    transcript(id: string, afterSeq: number): TranscriptPage {
      const attempt = mustFind(id);
      return transcripts.read(attempt, afterSeq, isTerminalState(attemptMachine, attempt.status));
    },

    /** Startup: sessions of a previous run are gone, so attempts still active then are interrupted (03 §2.1). */
    recover: reactions.interruptActive,
  };
}
export type AttemptsService = ReturnType<typeof createAttemptsService>;
