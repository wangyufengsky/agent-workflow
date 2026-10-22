import { PromptName, type Prompts, renderTemplate } from '@aw/builtin';
import {
  ATTEMPT_MAX_NUDGES,
  ATTEMPT_SUBMIT_TOOL,
  AttemptEvent,
  AttemptStatus,
  ErrorCode,
  InboxKind,
  MCP_TOOL_PREFIX,
  TranscriptSystemEvent,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import { type OpencodeClient, type OpencodeEvent, OpencodeEventType, ToolCallStatus } from '../opencode/index.ts';
import type { Attempt } from './attempts.repo.ts';
import { type AttemptState, errorOf, type LiveSession, systemEntry } from './attempts.state.ts';

const ACTIVE: readonly AttemptStatus[] = [AttemptStatus.Starting, AttemptStatus.Running];

type ToolEvent = Extract<OpencodeEvent, { type: typeof OpencodeEventType.Tool }>;
type PermissionEvent = Extract<OpencodeEvent, { type: typeof OpencodeEventType.PermissionAsked }>;

/**
 * The session protocol's end conditions that come from opencode (12 §4.2): idle with an open blocking question
 * (wait for the user), idle with answers to deliver, idle without a result (nudge, then ATTEMPT_NO_RESULT), session
 * errors, timeouts and a lost runtime. Permission requests become inbox items. Also turns every session event into
 * transcript entries and token usage.
 */
export function watchSessions(state: AttemptState, deps: { opencode: OpencodeClient; prompts: Prompts; clock: Clock }) {
  const { repo, live, mustFind, move, record } = state;

  async function send(attempt: Attempt, session: LiveSession, text: string): Promise<void> {
    try {
      await state.send(session, text);
    } catch (err) {
      const current = mustFind(attempt.id);
      if (current.status === AttemptStatus.Running) move(current, AttemptEvent.SessionError, errorOf(err));
    }
  }

  async function onIdle(attempt: Attempt, session: LiveSession): Promise<void> {
    session.idle = true;
    if (state.waitsForUser(attempt.id)) {
      state.park(session, attempt);
      return;
    }
    if (session.pendingAnswers.length > 0) {
      await send(attempt, session, session.pendingAnswers.splice(0).join('\n\n'));
      return;
    }
    if (attempt.nudges >= ATTEMPT_MAX_NUDGES) {
      move(attempt, AttemptEvent.NoResult, {
        code: ErrorCode.AttemptNoResult,
        message: 'Session went idle without submitting a result',
      });
      // The session is already idle, so no later idle event would release it.
      state.releaseSession(session);
      return;
    }
    repo.incrementNudges(attempt.id);
    state.publish(mustFind(attempt.id));
    record(attempt, [systemEntry(TranscriptSystemEvent.Nudged)]);
    await send(
      attempt,
      session,
      renderTemplate(deps.prompts[PromptName.Nudge], { submitTool: ATTEMPT_SUBMIT_TOOL[attempt.kind] }),
    );
  }

  /** Stops the session once the accepted submit call has returned, so its result still reaches the transcript. */
  function onToolEvent(attempt: Attempt, session: LiveSession, event: ToolEvent): void {
    const isSubmit = event.tool === `${MCP_TOOL_PREFIX}${ATTEMPT_SUBMIT_TOOL[attempt.kind]}`;
    const finished = event.status === ToolCallStatus.Completed || event.status === ToolCallStatus.Error;
    if (!session.stopAfterSubmit || !isSubmit || !finished) return;
    session.stopAfterSubmit = false;
    record(attempt, [systemEntry(TranscriptSystemEvent.ResultSubmitted)]);
    state.inBackground(attempt.id, () => state.stopSession(session));
  }

  /** A permission request waits in「需要你处理」until the user decides (03 §2.5). */
  function onPermission(attempt: Attempt, session: LiveSession, event: PermissionEvent): void {
    state.inbox.create({
      kind: InboxKind.Permission,
      taskId: attempt.taskId,
      nodeId: attempt.nodeId,
      attemptId: attempt.id,
      title: `${event.permission} ${event.patterns.join(' ')}`.trim(),
      payload: {
        opencodePermissionId: event.permissionId,
        sessionId: event.sessionId,
        directory: event.directory,
        permission: event.permission,
        patterns: event.patterns,
        always: event.always,
      },
    });
    state.park(session, attempt);
  }

  function interruptActive(): void {
    for (const attempt of repo.listByStatus(ACTIVE)) {
      if (attempt.status === AttemptStatus.Running && state.waitsForAnswer(attempt.id)) continue;
      record(attempt, [systemEntry(TranscriptSystemEvent.RuntimeLost)]);
      move(attempt, AttemptEvent.RuntimeLost);
    }
    for (const session of [...live.values()]) {
      session.cancelTimeout();
      state.releaseSession(session);
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
        if (running) state.inBackground(attempt.id, () => onIdle(attempt, session));
        else state.releaseSession(session);
        return;
      case OpencodeEventType.Error:
        if (!running) return;
        move(attempt, AttemptEvent.SessionError, {
          code: ErrorCode.AttemptSessionError,
          message: event.error?.name ?? 'session error',
          ...(event.error === undefined ? {} : { details: { error: event.error } }),
        });
        return;
      case OpencodeEventType.Tool:
        onToolEvent(attempt, session, event);
        return;
      case OpencodeEventType.PermissionAsked:
        if (running) onPermission(attempt, session, event);
        return;
      default:
        return;
    }
  }

  /** `attempt.timeoutMinutes` passed while running: stop the session and fail. */
  function timeOut(attemptId: string): void {
    const attempt = mustFind(attemptId);
    if (attempt.status !== AttemptStatus.Running) return;
    record(attempt, [systemEntry(TranscriptSystemEvent.TimedOut)]);
    move(attempt, AttemptEvent.Timeout, { code: ErrorCode.AttemptTimeout, message: 'Attempt timed out' });
    const session = state.sessionOf(attemptId);
    if (session !== undefined) state.inBackground(attemptId, () => state.stopSession(session));
  }

  deps.opencode.subscribe(onEvent);

  return {
    timeOut,
    interruptActive,
    /**
     * The user answered or decided: once the session waits for nothing else it resumes. If its turn already ended,
     * that idle is handled now (queued answers go out); otherwise the turn's own end will be.
     */
    resume(session: LiveSession): void {
      if (!session.parked || state.waitsForUser(session.attemptId)) return;
      session.parked = false;
      session.cancelTimeout = deps.clock.schedule(session.timeoutMs, () => timeOut(session.attemptId));
      const attempt = mustFind(session.attemptId);
      state.signal('input_answered', attempt);
      if (session.idle) state.inBackground(attempt.id, () => onIdle(attempt, session));
    },
  };
}
