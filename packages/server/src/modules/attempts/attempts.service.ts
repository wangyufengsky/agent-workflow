import { randomUUID } from 'node:crypto';
import type { Prompts } from '@aw/builtin';
import {
  AppError,
  ATTEMPT_STATUSES,
  type AttemptDTO,
  AttemptEvent,
  type AttemptKind,
  AttemptStatus,
  type AttemptSummaryDTO,
  attemptMachine,
  BASH_PERMISSION,
  ErrorCode,
  isTerminalState,
  OPENCODE_AGENT_NAME,
  PermissionDecision,
  type PermissionPayload,
  type SessionAgent,
  type TranscriptPage,
  TranscriptSystemEvent,
} from '@aw/shared';
import { parseModelRef, sessionPermissionRules } from '../opencode/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { SettingsService } from '../settings/index.ts';
import { watchSessions } from './attempts.reactions.ts';
import type { Attempt } from './attempts.repo.ts';
import { createSessionView } from './attempts.session-view.ts';
import {
  type AttemptSignal,
  type AttemptStateDeps,
  createAttemptState,
  errorOf,
  type LiveSession,
  systemEntry,
} from './attempts.state.ts';

export type AttemptsServiceDeps = AttemptStateDeps & {
  settings: SettingsService;
  prompts: Prompts;
  projects: Pick<ProjectsService, 'allowedBash' | 'rememberBash'>;
};

export type StartAttemptInput = {
  /** Given by an owner that records the attempt before the session can call back (a knowledge turn, 18 §5.3). */
  id?: string;
  kind: AttemptKind;
  taskId: string | null;
  nodeId: string | null;
  roleId: string | null;
  /** The project the session works in: its always-allowed bash patterns join the session rules (D101). */
  projectId: string | null;
  /** The role's base agent, or the researcher: decides the opencode agent and its session rules (12 §2). */
  agent: SessionAgent;
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
  /** Check commands a read-only session may run without asking (12 §2). */
  checkCommands?: readonly string[];
  /** The researcher may use the web (18 §5.1). */
  web?: boolean;
};

/** What re-attaching to a persisted session needs after a restart: the session state lived in memory. */
export type ResumeInput = { agent: SessionAgent; system: string | undefined };

const ACTIVE: readonly AttemptStatus[] = [AttemptStatus.Starting, AttemptStatus.Running];

/** Attempt lifecycle (09 §4) and the session protocol (12 §4); opencode-driven end conditions are in the reactions. */
export function createAttemptsService(deps: AttemptsServiceDeps) {
  const { clock, opencode, settings, transcripts, projects } = deps;
  const state = createAttemptState(deps);
  const { repo, mustFind, move, record, toDto } = state;
  const reactions = watchSessions(state, deps);

  function requireReady(): void {
    if (!opencode.isConnected()) throw new AppError(ErrorCode.OpencodeNotReady, 'opencode is not ready');
  }

  /** Registers the session as ours, with the attempt timeout running. */
  function track(
    attempt: Attempt,
    session: Pick<LiveSession, 'attemptId' | 'taskId' | 'sessionId' | 'directory' | 'agent' | 'model' | 'system'>,
    parked: boolean,
  ): LiveSession {
    const timeoutMs = settings.get('attempt.timeoutMinutes') * 60_000;
    const { promise: released, resolve: release } = Promise.withResolvers<void>();
    const tracked: LiveSession = {
      ...session,
      view: createSessionView(),
      timeoutMs,
      cancelTimeout: parked ? () => undefined : clock.schedule(timeoutMs, () => reactions.timeOut(attempt.id)),
      stopAfterSubmit: false,
      parked,
      // A session re-attached after a restart waits idle for its answer.
      idle: parked,
      pendingAnswers: [],
      released,
      release,
    };
    state.live.set(session.sessionId, tracked);
    return tracked;
  }

  /** Sends a message; a failure to deliver it fails the attempt like a session error. */
  async function sendOrFail(session: LiveSession, text: string): Promise<void> {
    try {
      await state.send(session, text);
    } catch (err) {
      const current = mustFind(session.attemptId);
      if (current.status === AttemptStatus.Running) move(current, AttemptEvent.SessionError, errorOf(err));
    }
  }

  return {
    get: (id: string): AttemptDTO => toDto(mustFind(id)),
    /** The project the attempt's session works in (none for debug attempts and PPTs without a project). */
    projectOf: (id: string): string | null => mustFind(id).projectId,
    /** Summaries of several attempts at once (a list page), by id. */
    summaries: (ids: readonly string[]): Map<string, AttemptSummaryDTO> =>
      new Map(repo.findMany(ids).map((a) => [a.id, state.toSummary(a)])),
    isReady: (): boolean => opencode.isConnected(),
    requireReady,
    onSignal: state.onSignal,

    /** Execute and review attempts of a node, oldest first. */
    listByNode: (nodeId: string): AttemptSummaryDTO[] => repo.listByNode(nodeId).map(state.toSummary),
    /** Every active attempt, for task summaries. */
    listActiveAll: (): AttemptSummaryDTO[] => repo.listByStatus(ACTIVE).map(state.toSummary),
    /** Active (starting / running) attempts of a task. */
    listActive: (taskId: string): AttemptSummaryDTO[] => repo.listByTask(taskId, ACTIVE).map(state.toSummary),
    listByTask: (taskId: string): AttemptSummaryDTO[] => repo.listByTask(taskId, ATTEMPT_STATUSES).map(state.toSummary),
    latestPlanAttempt: (taskId: string): AttemptDTO | undefined => {
      const attempt = repo.findLatestPlan(taskId);
      return attempt === undefined ? undefined : toDto(attempt);
    },
    roleIdOf: (attemptId: string): string | null => mustFind(attemptId).roleId,
    usesRole: (roleId: string): boolean => repo.hasRole(roleId),

    /**
     * Creates the session and sends the first message (12 §4.1); the attempt is then `running`. The attempt row is
     * written before the first await, so a caller that does not wait still sees it as active.
     */
    async start(input: StartAttemptInput): Promise<AttemptDTO> {
      requireReady();
      const model = input.model === null ? undefined : parseModelRef(input.model);
      const id = input.id ?? randomUUID();
      repo.insert({
        id,
        taskId: input.taskId,
        nodeId: input.nodeId,
        roleId: input.roleId,
        projectId: input.projectId,
        kind: input.kind,
        seq: repo.nextSeq(input),
        status: AttemptStatus.Starting,
        model: input.model,
        directory: input.directory,
        opencodeSessionId: null,
        nudges: 0,
        startedAt: clock.now(),
      });
      state.publish(mustFind(id));
      record(mustFind(id), [systemEntry(TranscriptSystemEvent.AttemptStarted)]);

      const agent = OPENCODE_AGENT_NAME[input.agent];
      let sessionId: string;
      try {
        sessionId = await opencode.createSession({
          directory: input.directory,
          title: input.title,
          agent,
          permission: sessionPermissionRules(input.agent, settings.get('ai.bashPolicy'), {
            checkCommands: input.checkCommands,
            web: input.web,
            allowedBash: input.projectId === null ? [] : projects.allowedBash(input.projectId),
          }),
        });
      } catch (err) {
        const current = mustFind(id);
        // The runtime went away while the session was being created (crash, restart, app quit): the attempt is
        // interrupted already and the failed request was part of that.
        if (current.status !== AttemptStatus.Starting) return toDto(current);
        return toDto(move(current, AttemptEvent.StartFailed, errorOf(err)));
      }
      repo.setSession(id, sessionId);
      const attempt = mustFind(id);
      // The runtime may have gone away (or the task been cancelled) while the session was being created.
      if (attempt.status !== AttemptStatus.Starting) return toDto(attempt);

      const session = track(
        attempt,
        {
          attemptId: id,
          taskId: input.taskId,
          sessionId,
          directory: input.directory,
          agent,
          model,
          system: input.system,
        },
        false,
      );
      // Running before the first prompt, so every event of the session finds the attempt active.
      move(attempt, AttemptEvent.SessionStarted);
      await sendOrFail(session, input.prompt);
      return toDto(mustFind(id));
    },

    /**
     * A new attempt on the session of an earlier one (re-planning, 12 §4.3; a knowledge follow-up, 18 §5.3; PPT work,
     * 23 §4.1): the model keeps what it read and receives `prompt` as the next message, with the previous attempt's
     * model and kind unless `model` / `kind` give others. Synchronous up to sending, like `start`.
     */
    async continueSession(
      previousId: string,
      input: { id?: string; prompt: string; model?: string | null; kind?: AttemptKind } & ResumeInput,
    ): Promise<AttemptDTO> {
      requireReady();
      const previous = mustFind(previousId);
      if (previous.opencodeSessionId === null) {
        throw new AppError(ErrorCode.AttemptNotFound, `Attempt ${previousId} has no session`, { id: previousId });
      }
      const model = input.model === undefined ? previous.model : input.model;
      // A PPT's outline and pages are different kinds of work on one session (23 §7.1).
      const kind = input.kind ?? previous.kind;
      const id = input.id ?? randomUUID();
      repo.insert({
        id,
        taskId: previous.taskId,
        nodeId: previous.nodeId,
        roleId: previous.roleId,
        projectId: previous.projectId,
        kind,
        seq: repo.nextSeq({ ...previous, kind }),
        status: AttemptStatus.Starting,
        model,
        directory: previous.directory,
        opencodeSessionId: previous.opencodeSessionId,
        nudges: 0,
        startedAt: clock.now(),
      });
      record(mustFind(id), [systemEntry(TranscriptSystemEvent.AttemptStarted)]);
      // The previous turn on this session may still be winding down (the abort after its submit); its last events
      // must not reach the new attempt.
      const winding = state.live.get(previous.opencodeSessionId);
      if (winding !== undefined) await winding.released;
      const attempt = mustFind(id);
      // Cancelled while waiting.
      if (attempt.status !== AttemptStatus.Starting) return toDto(attempt);
      const session = track(
        attempt,
        {
          attemptId: id,
          taskId: previous.taskId,
          sessionId: previous.opencodeSessionId,
          directory: previous.directory,
          agent: OPENCODE_AGENT_NAME[input.agent],
          model: model === null ? undefined : parseModelRef(model),
          system: input.system,
        },
        false,
      );
      move(attempt, AttemptEvent.SessionStarted);
      await sendOrFail(session, input.prompt);
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

    /** User abort (11 §6) or task cancellation. */
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

    /**
     * An answer to the attempt's question (12 §4.2): sent as the next message once the session waits for nothing
     * else; while it is still working the answer waits for its next idle. After a restart the persisted session is
     * re-attached. An attempt that already ended keeps the answer only in the task context.
     */
    async deliverAnswer(attemptId: string, text: string, resume: ResumeInput): Promise<void> {
      const attempt = mustFind(attemptId);
      if (attempt.status !== AttemptStatus.Running || attempt.opencodeSessionId === null) return;
      const session =
        state.sessionOf(attemptId) ??
        track(
          attempt,
          {
            attemptId,
            taskId: attempt.taskId,
            sessionId: attempt.opencodeSessionId,
            directory: attempt.directory,
            agent: OPENCODE_AGENT_NAME[resume.agent],
            model: attempt.model === null ? undefined : parseModelRef(attempt.model),
            system: resume.system,
          },
          true,
        );
      session.pendingAnswers.push(text);
      reactions.resume(session);
    },

    /**
     * The user's decision on a permission request goes back to opencode, and the turn continues (D34). opencode keeps
     * 「总是允许」for the session only; a bash one is remembered for the project's later sessions too (D101).
     */
    async replyPermission(attemptId: string, payload: PermissionPayload, reply: PermissionDecision): Promise<void> {
      await opencode.replyPermission({
        permissionId: payload.opencodePermissionId,
        directory: payload.directory,
        reply,
      });
      const { projectId } = mustFind(attemptId);
      if (reply === PermissionDecision.Always && payload.permission === BASH_PERMISSION && projectId !== null) {
        projects.rememberBash(projectId, payload.patterns);
      }
    },

    /** Once nothing is left to wait for (the permission item was resolved), the session resumes. */
    resumeIfAnswered(attemptId: string): void {
      const session = state.sessionOf(attemptId);
      if (session !== undefined) reactions.resume(session);
    },

    /**
     * Deletes ended attempts with their transcripts (a deleted knowledge conversation, 18 §3). A session that just
     * ended may still be winding down (the submit call returning, the abort after it): it is stopped and no longer
     * followed, so its last events find no attempt to update and the abort we would have sent after the submit is
     * not lost.
     */
    delete(ids: readonly string[]): void {
      const attempts = ids.map(mustFind);
      for (const attempt of attempts) {
        const session = state.sessionOf(attempt.id);
        if (session === undefined) continue;
        state.releaseSession(session);
        state.inBackground(attempt.id, () => state.stopSession(session));
      }
      repo.deleteMany(ids);
      for (const attempt of attempts) transcripts.remove(attempt);
    },

    transcript(id: string, afterSeq: number): TranscriptPage {
      const attempt = mustFind(id);
      return transcripts.read(attempt, afterSeq, isTerminalState(attemptMachine, attempt.status));
    },

    /**
     * Startup: sessions of a previous run are gone, so attempts still active then are interrupted (03 §2.1), except
     * those waiting for the answer to a blocking question: their persisted session continues when it arrives.
     */
    recover: reactions.interruptActive,
  };
}
export type AttemptsService = ReturnType<typeof createAttemptsService>;
export type { AttemptSignal };
