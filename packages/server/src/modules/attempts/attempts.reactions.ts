import { PromptName, type Prompts, renderTemplate } from '@aw/builtin';
import {
  ATTEMPT_MAX_NUDGES,
  ATTEMPT_SUBMIT_TOOL,
  AttemptEvent,
  AttemptStatus,
  ErrorCode,
  MCP_TOOL_PREFIX,
  TranscriptSystemEvent,
} from '@aw/shared';
import { type OpencodeClient, type OpencodeEvent, OpencodeEventType, ToolCallStatus } from '../opencode/index.ts';
import type { Attempt } from './attempts.repo.ts';
import { type AttemptState, errorOf, type LiveSession, systemEntry } from './attempts.state.ts';

const ACTIVE: readonly AttemptStatus[] = [AttemptStatus.Starting, AttemptStatus.Running];

type ToolEvent = Extract<OpencodeEvent, { type: typeof OpencodeEventType.Tool }>;

/**
 * The session protocol's end conditions that come from opencode (12 §4.2): idle without a result (nudge, then
 * ATTEMPT_NO_RESULT), session errors, timeouts and a lost runtime. Also turns every session event into transcript
 * entries and token usage.
 */
export function watchSessions(state: AttemptState, deps: { opencode: OpencodeClient; prompts: Prompts }) {
  const { repo, live, mustFind, move, record } = state;

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
    state.publish(mustFind(attempt.id));
    record(attempt, [systemEntry(TranscriptSystemEvent.Nudged)]);
    const nudge = renderTemplate(deps.prompts[PromptName.Nudge], { submitTool: ATTEMPT_SUBMIT_TOOL[attempt.kind] });
    try {
      await state.send(session, nudge);
    } catch (err) {
      const current = mustFind(attempt.id);
      if (current.status === AttemptStatus.Running) move(current, AttemptEvent.SessionError, errorOf(err));
    }
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

  function interruptActive(): void {
    for (const attempt of repo.listByStatus(ACTIVE)) {
      record(attempt, [systemEntry(TranscriptSystemEvent.RuntimeLost)]);
      move(attempt, AttemptEvent.RuntimeLost);
    }
    for (const session of live.values()) session.cancelTimeout();
    live.clear();
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
        else live.delete(session.sessionId);
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
      default:
        return;
    }
  }

  deps.opencode.subscribe(onEvent);

  return {
    interruptActive,
    /** `attempt.timeoutMinutes` passed while running: stop the session and fail. */
    timeOut(attemptId: string): void {
      const attempt = mustFind(attemptId);
      if (attempt.status !== AttemptStatus.Running) return;
      record(attempt, [systemEntry(TranscriptSystemEvent.TimedOut)]);
      move(attempt, AttemptEvent.Timeout, { code: ErrorCode.AttemptTimeout, message: 'Attempt timed out' });
      const session = state.sessionOf(attemptId);
      if (session !== undefined) state.inBackground(attemptId, () => state.stopSession(session));
    },
  };
}
