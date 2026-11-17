import { PromptName, type Prompts, renderTemplate } from '@aw/builtin';
import {
  ACTIVE_ATTEMPT_STATUSES,
  AppError,
  ATTEMPT_MAX_NUDGES,
  ATTEMPT_SUBMIT_TOOL,
  AttemptEvent,
  AttemptKind,
  AttemptStatus,
  ErrorCode,
  InboxKind,
  MCP_TOOL_PREFIX,
  McpToolName,
  TranscriptSystemEvent,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Logger } from '../../core/logger.ts';
import type { ModelSlots } from '../model-slots/index.ts';
import {
  describeOpencodeError,
  MESSAGE_ABORTED_ERROR,
  type OpencodeClient,
  type OpencodeEvent,
  OpencodeEventType,
  ToolCallStatus,
} from '../opencode/index.ts';
import type { Attempt } from './attempts.repo.ts';
import { type AttemptState, errorOf, type LiveSession, systemEntry } from './attempts.state.ts';

type ToolEvent = Extract<OpencodeEvent, { type: typeof OpencodeEventType.Tool }>;
type PermissionEvent = Extract<OpencodeEvent, { type: typeof OpencodeEventType.PermissionAsked }>;

/**
 * The session protocol's end conditions that come from opencode (12 §4.2): idle with an open blocking question
 * (wait for the user), idle with answers to deliver, idle without a result (nudge, then ATTEMPT_NO_RESULT), session
 * errors, timeouts and a lost runtime. Permission requests become inbox items. While opencode retries a failed model
 * request the attempt waits for the model service without its timeout running, so an unreachable service costs no
 * retry budget (D163). A reply the model service stalled on is stopped instead, with the attempt's timeout running,
 * and the session is asked to continue in shorter tool calls (D217). Also turns every session event into transcript
 * entries and token usage.
 */
export function watchSessions(
  state: AttemptState,
  deps: { opencode: OpencodeClient; prompts: Prompts; clock: Clock; slots: Pick<ModelSlots, 'changed'>; log: Logger },
  isLocal: (id: string) => boolean,
) {
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
    const { stall } = session;
    if (stall !== null) {
      stall.idled = true;
      await stall.stopped;
      stall.continued = true;
    }
    const messages = session.pendingAnswers.splice(0);
    if (stall !== null) messages.unshift(deps.prompts[PromptName.ModelStalled]);
    if (messages.length > 0) {
      await send(attempt, session, messages.join('\n\n'));
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
      renderTemplate(deps.prompts[PromptName.Nudge], {
        submitTool:
          session.submitTool === null
            ? 'the submission tool named in your instructions'
            : `\`${MCP_TOOL_PREFIX}${session.submitTool}\``,
      }),
    );
  }

  /** 提交工具已经返回，停止本轮生成后在原会话执行结束命令。 */
  async function runEndCommand(attempt: Attempt, session: LiveSession, command: string): Promise<void> {
    try {
      await state.stopSession(session);
      if (live.get(session.sessionId) === session) await state.runCommand(session, command);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      deps.log.warn({ err, attemptId: attempt.id }, 'session end command failed');
      if (live.get(session.sessionId) === session) {
        record(attempt, [systemEntry(TranscriptSystemEvent.SessionEndCommandFailed)]);
        await state.stopSession(session);
      }
    } finally {
      state.releaseSession(session);
    }
  }

  function finishSubmitted(attempt: Attempt, session: LiveSession): void {
    session.stopAfterSubmit = false;
    record(attempt, [systemEntry(TranscriptSystemEvent.ResultSubmitted)]);
    const command = session.endCommand;
    if (command === null) {
      state.inBackground(attempt.id, () => state.stopSession(session));
    } else {
      session.finishingCommand = true;
      state.inBackground(attempt.id, () => runEndCommand(attempt, session, command));
    }
  }

  /** Stops the session once the accepted submit call has returned, so its result still reaches the transcript. */
  function onToolEvent(attempt: Attempt, session: LiveSession, event: ToolEvent): void {
    const isSubmit =
      event.tool === `${MCP_TOOL_PREFIX}${ATTEMPT_SUBMIT_TOOL[attempt.kind]}` ||
      (attempt.kind === AttemptKind.Execute && event.tool === `${MCP_TOOL_PREFIX}${McpToolName.BrowserSubmitReport}`);
    const finished = event.status === ToolCallStatus.Completed || event.status === ToolCallStatus.Error;
    if (session.stopAfterSubmit && isSubmit && finished) finishSubmitted(attempt, session);
  }

  /** A permission request waits in「需要你处理」until the user decides (03 §2.5). */
  function onPermission(attempt: Attempt, event: PermissionEvent): void {
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
      },
    });
  }

  /**
   * Whether `event` belongs to the reply stopped after a stall (D217): its abort error, and idle events after the first
   * until the continuation reports busy (opencode may report an aborted turn's end more than once, and late).
   */
  function endsStoppedReply(stall: NonNullable<LiveSession['stall']>, event: OpencodeEvent): boolean {
    if (event.type === OpencodeEventType.Error) return event.error?.name === MESSAGE_ABORTED_ERROR;
    if (event.type === OpencodeEventType.Idle) return stall.idled;
    return false;
  }

  /** Runs the attempt's timeout for `ms` from now. */
  function arm(session: LiveSession, ms: number): void {
    session.timeoutAt = deps.clock.now() + ms;
    session.cancelTimeout = deps.clock.schedule(ms, () => timeOut(session.attemptId));
  }

  /** opencode waits to retry a failed model request: that time is the model service's, not the attempt's. */
  function waitForModel(session: LiveSession): void {
    if (session.parked || session.modelWaitLeftMs !== null) return;
    session.cancelTimeout();
    session.modelWaitLeftMs = session.timeoutAt - deps.clock.now();
    deps.slots.changed();
  }

  /** The session sends a request again or makes progress: the timeout goes on with what was left. */
  function modelAnswering(session: LiveSession): void {
    if (session.modelWaitLeftMs === null) return;
    arm(session, session.modelWaitLeftMs);
    session.modelWaitLeftMs = null;
    deps.slots.changed();
  }

  function interruptActive(runtimeLost = false): void {
    for (const attempt of repo.listByStatus(ACTIVE_ATTEMPT_STATUSES)) {
      if (runtimeLost && isLocal(attempt.id)) continue;
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
      interruptActive(true);
      return;
    }
    const session = live.get(event.sessionId);
    if (session === undefined) return;
    if (session.stall !== null && endsStoppedReply(session.stall, event)) return;
    const attempt = mustFind(session.attemptId);
    const running = attempt.status === AttemptStatus.Running;
    // 命令请求单独处理失败。开始命令的迟到事件按顺序先于首条任务消息，结束命令发生在提交之后。
    if (event.type === OpencodeEventType.Error && (!running || session.firstPrompt !== null)) return;
    record(attempt, session.view.toEntries(event));
    if (running && session.firstPrompt === null) {
      if (event.type === OpencodeEventType.Retry) waitForModel(session);
      else modelAnswering(session);
    }
    if (event.type === OpencodeEventType.Busy && session.stall?.continued === true) session.stall = null;
    switch (event.type) {
      case OpencodeEventType.StepFinished:
        repo.addUsage(attempt.id, { ...event.tokens, cost: event.cost });
        return;
      case OpencodeEventType.Message:
        if (event.messageId === session.firstPrompt?.messageId) session.firstPrompt = null;
        return;
      case OpencodeEventType.Idle:
        if (session.finishingCommand) return;
        if (running) {
          if (session.firstPrompt === null) state.inBackground(attempt.id, () => onIdle(attempt, session));
        } else if (session.stopAfterSubmit && session.endCommand !== null) {
          finishSubmitted(attempt, session);
        } else state.releaseSession(session);
        return;
      case OpencodeEventType.Error:
        move(attempt, AttemptEvent.SessionError, {
          code: ErrorCode.AttemptSessionError,
          message: describeOpencodeError(event.error),
          ...(event.error === undefined ? {} : { details: { error: event.error } }),
        });
        return;
      case OpencodeEventType.Stalled: {
        if (!running || session.firstPrompt !== null || session.stall !== null) return;
        // opencode would send the whole request again and stall the same way: stop it and ask for shorter calls.
        const stopped = state.stopSession(session);
        session.stall = { stopped, idled: false, continued: false };
        state.inBackground(attempt.id, () => stopped);
        return;
      }
      case OpencodeEventType.Tool:
        onToolEvent(attempt, session, event);
        return;
      case OpencodeEventType.PermissionAsked:
        if (running || session.finishingCommand) onPermission(attempt, event);
        if (running) state.park(session, attempt);
        return;
      case OpencodeEventType.PermissionReplied:
        state.inbox.completePermission(attempt.id, event.permissionId, event.reply);
        if (running) resume(session);
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

  /**
   * The user answered or decided: once the session waits for nothing else it resumes. If its turn already ended,
   * that idle is handled now (queued answers go out); otherwise the turn's own end will be.
   */
  function resume(session: LiveSession): void {
    if (!session.parked || state.waitsForUser(session.attemptId)) return;
    session.parked = false;
    if (session.firstPrompt?.messageId !== null) arm(session, session.timeoutMs);
    deps.slots.changed();
    const attempt = mustFind(session.attemptId);
    state.signal('input_answered', attempt);
    if (session.idle) state.inBackground(attempt.id, () => onIdle(attempt, session));
  }
  return { arm, timeOut, interruptActive, resume };
}
