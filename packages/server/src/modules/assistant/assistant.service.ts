import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  AppError,
  ASSISTANT_CONVERSATIONS_DIR,
  ASSISTANT_DIR,
  ASSISTANT_FILES_DIR,
  ASSISTANT_RECOVERY_ENTRIES,
  ASSISTANT_TITLE_MAX_CHARS,
  type AssistantConversationDTO,
  type AssistantFileDTO,
  type AssistantPageRef,
  type AssistantPermissionRequestDTO,
  AssistantTurnEvent,
  AssistantTurnStatus,
  type AssistantUsageDTO,
  type AttachmentDTO,
  AttachmentOwnerKind,
  type ChartSpec,
  ErrorCode,
  type ExternalMcpServerDTO,
  MCP_ASSISTANT_SERVER_NAME,
  MCP_ASSISTANT_TOOL_PREFIX,
  MCP_SERVER_NAME,
  modelEfforts,
  type OfficeLossItem,
  OPENCODE_ASSISTANT_AGENT,
  type OperationContract,
  PermissionDecision,
  PermissionMode,
  producedEntity,
  type SendAssistantMessageRequest,
  ServerEventType,
  type TranscriptEntry,
  TranscriptEntryKind,
  type TranscriptPage,
  TranscriptSystemEvent,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { EventBus } from '../../core/event-bus.ts';
import type { Logger } from '../../core/logger.ts';
import type { AttachmentsService } from '../attachments/index.ts';
import {
  createSessionView,
  createTranscriptStore,
  type NewTranscriptEntry,
  type SessionView,
} from '../attempts/index.ts';
import type { ModelSlots } from '../model-slots/index.ts';
import {
  type AssistantPrompt,
  assistantPermissionRules,
  createMessageId,
  type OpencodeClient,
  type OpencodeError,
  type OpencodeEvent,
  OpencodeEventType,
  parseModelRef,
  type SessionDispatcher,
  SessionPurpose,
  ToolCallStatus,
} from '../opencode/index.ts';
import { grantKey, type PermissionReviewer, scopedRules } from '../permissions/index.ts';
import type { SettingsService } from '../settings/index.ts';
import { type SkillsService, withUserSkills } from '../skills/index.ts';
import { type ContextRenderer, localTime } from './assistant.context.ts';
import { continuationBudget, fitContinuation } from './assistant.continuation-budget.ts';
import { continuationContext } from './assistant.continuation-context.ts';
import type { AssistantMemory } from './assistant.memory.ts';
import { recoveryContext } from './assistant.recovery-context.ts';
import { type Conversation, createAssistantRepo } from './assistant.repo.ts';
import { createAssistantUsage } from './assistant.usage.ts';
import { readAssistantHistory } from './assistant-history.ts';
export type AssistantServiceDeps = {
  permissionReviewer: PermissionReviewer;
  skills: SkillsService;
  db: Db;
  unit: UnitOfWork;
  events: EventBus;
  clock: Clock;
  log: Logger;
  opencode: OpencodeClient;
  sessions: SessionDispatcher;
  settings: SettingsService;
  attachments: AttachmentsService;
  context: ContextRenderer;
  cleanupDatabaseInvestigations(): Promise<void>;
  memory: AssistantMemory;
  projects: import('../projects/index.ts').ProjectsService;
  slots: ModelSlots;
  dataDir: string;
  /** IANA zone the user's times are given in (15 §2). */
  timeZone: string;
};

type TurnOutcome = { error: OpencodeError | undefined } | { requestError: unknown };
type Turn = {
  delegation: AbortController;
  intent: string;
  source: 'user' | 'app';
  confirmedStop: typeof AssistantTurnEvent.Abort | typeof AssistantTurnEvent.Timeout | null;
  abortPending: Promise<void> | null;
  request: AssistantPrompt | null;
  id: number;
  messageId: string;
  completion: Promise<void> | null;
  outcome: TurnOutcome | null;
};

/** What we keep about a conversation while the app runs; lost on restart like the session's turn (D46). */
type Live = {
  busy: boolean;
  /** 外部请求尚未返回时，空闲事件也不能放行下一次发送。 */
  sending: boolean;
  /** 删除外部会话期间禁止新发送和自动回传。 */
  deleting: boolean;
  /** The user asked to stop: the abort's own error is not the conversation's. */
  aborting: boolean;
  stopping: boolean;
  /** The next turn waits for a model slot (D186); it starts once granted. */
  queued: boolean;
  turn: Turn | null;
  view: SessionView;
  permissions: Map<string, AssistantPermissionRequestDTO>;
  deciding: Map<string, AbortController>;
  grants: Set<string>;
  /** Files already shown as attachments. */
  attached: Set<string>;
  /** Where the user was at their last message; told to the model with messages the app sends. */
  page: AssistantPageRef | undefined;
};

/** opencode tools that write a file given as `filePath` (opencode 1.19). */
const FILE_WRITING_TOOLS: ReadonlySet<string> = new Set(['write', 'edit']);

/** The first line of the first message names the conversation. */
const titleOf = (text: string) =>
  text
    .trim()
    .replace(/\s*\n[\s\S]*/, '')
    .slice(0, ASSISTANT_TITLE_MAX_CHARS);

/**
 * Assistant conversations (15): each is one opencode session of `aw-assistant` running in its own `<data dir>/assistant/files/<id>/`.
 * Messages go out with the per-turn context; the session's events become the conversation's message stream.
 */
export function createAssistantService(deps: AssistantServiceDeps) {
  const { db, unit, events, clock, log, opencode, settings, attachments, context, slots, sessions: dispatch } = deps;
  const repo = createAssistantRepo(db);
  // opencode 使用真实路径判断目录边界，macOS 的 /var 等别名也必须先规范化。
  const directory = join(realpathSync(deps.dataDir), ASSISTANT_DIR);
  const live = new Map<string, Live>();
  const usage = createAssistantUsage({
    ...deps,
    onTimeout(id) {
      stopTurn(id, AssistantTurnEvent.Timeout).catch((err: unknown) =>
        log.error({ err, conversationId: id }, 'assistant timeout abort failed'),
      );
    },
    onChange: slots.changed,
  });
  slots.addCounter(usage.usingModel);
  /** opencode session id → conversation id, for the sessions this run has used. */
  const sessions = new Map<string, string>();
  const transcriptFile = (c: { id: string }) => join(directory, ASSISTANT_CONVERSATIONS_DIR, `${c.id}.jsonl`);
  const transcripts = createTranscriptStore<{ id: string }>({
    fileOf: transcriptFile,
    onAppend: (c, entries) =>
      events.publish({ type: ServerEventType.AssistantTranscript, data: { conversationId: c.id, entries } }),
    clock,
  });

  const filesDir = (id: string) => join(directory, ASSISTANT_FILES_DIR, id);
  /** A real path (links followed) that is the conversation's files directory or inside it; `directory` is real. */
  const within = (id: string, real: string) => {
    const inside = relative(filesDir(id), real);
    return !inside.startsWith('..') && !isAbsolute(inside);
  };

  function liveOf(id: string): Live {
    let state = live.get(id);
    if (state === undefined) {
      state = {
        busy: false,
        sending: false,
        deleting: false,
        aborting: false,
        stopping: false,
        queued: false,
        turn: null,
        view: createSessionView(),
        permissions: new Map(),
        deciding: new Map(),
        grants: new Set(),
        attached: new Set(),
        page: undefined,
      };
      live.set(id, state);
    }
    return state;
  }

  function get(id: string): Conversation {
    const conversation = repo.findConversation(id);
    if (conversation === undefined) {
      throw new AppError(ErrorCode.AssistantConversationNotFound, `Conversation ${id} not found`, { id });
    }
    return conversation;
  }

  function toDto(
    c: Conversation,
    summary: AssistantUsageDTO = usage.get(c.id),
    continuationInfo?: { continuation: ReturnType<typeof repo.findContinuation>; sourceAvailable: boolean },
  ): AssistantConversationDTO {
    const state = liveOf(c.id);
    const continuation = continuationInfo === undefined ? repo.findContinuation(c.id) : continuationInfo.continuation;
    return {
      continuation:
        continuation === undefined
          ? null
          : {
              sourceConversationId: continuation.sourceConversationId,
              sourceAvailable:
                continuationInfo === undefined
                  ? repo.findConversation(continuation.sourceConversationId) !== undefined
                  : continuationInfo.sourceAvailable,
              cutoffSeq: continuation.cutoffSeq,
              createdAt: continuation.createdAt,
              handoffKind: continuation.handoffKind,
              attachmentIds: continuation.attachmentIds,
              draftText: continuation.draftText,
              consumedAt: continuation.consumedAt,
            },
      id: c.id,
      title: c.title,
      projectId: c.projectId,
      permissionMode: c.permissionMode,
      busy: state.busy || state.sending || state.deleting || state.stopping,
      queuePosition: slots.position(c.id),
      pendingPermissions: [...state.permissions.values()],
      usage: summary,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  function publish(id: string): AssistantConversationDTO {
    const dto = toDto(get(id));
    events.publish({ type: ServerEventType.AssistantUpdated, data: dto });
    return dto;
  }

  function record(c: Conversation, entries: readonly NewTranscriptEntry[]): void {
    transcripts.append(c, entries);
  }

  function system(c: Conversation, page: AssistantPageRef | undefined, source: 'user' | 'app'): string {
    return context.render({
      time: localTime(clock.now(), deps.timeZone),
      uiMode: settings.get('ui.mode'),
      page,
      projectId: c.projectId,
      source,
      filesDir: `. (absolute: ${filesDir(c.id)})`,
    });
  }

  async function sessionOf(c: Conversation): Promise<string> {
    let current = c;
    if (!current.isolated) {
      const previousSession = current.opencodeSessionId;
      const history = recoveryContext(transcripts.tail(c, ASSISTANT_RECOVERY_ENTRIES));
      unit.transact(() => {
        repo.updateConversation(c.id, { isolated: true, retiredSessionId: previousSession, opencodeSessionId: null });
        if (previousSession !== null) repo.enqueueMessage(c.id, history, clock.now());
      });
      if (previousSession !== null)
        record(c, [{ kind: TranscriptEntryKind.System, data: { event: TranscriptSystemEvent.AssistantIsolated } }]);
      current = get(c.id);
    }
    // 删除失败时保留退休 id；下次恢复继续清理，绝不回到旧目录运行。
    if (current.retiredSessionId !== null) {
      await opencode.deleteSession({ sessionId: current.retiredSessionId, directory });
      repo.updateConversation(c.id, { retiredSessionId: null });
    }
    const previousSessionId = current.opencodeSessionId;
    if (previousSessionId !== null && !sessions.has(previousSessionId))
      await opencode.setPermissions({
        sessionId: previousSessionId,
        directory: filesDir(c.id),
        permission: scopedRules(assistantPermissionRules()),
      });
    if (previousSessionId === null) mkdirSync(filesDir(c.id), { recursive: true });
    const binding = dispatch.bind({
      purpose: SessionPurpose.Assistant,
      ownerId: c.id,
      ...(previousSessionId === null ? {} : { existing: previousSessionId }),
      input: {
        directory: filesDir(c.id),
        title: `Assistant · ${c.title}`,
        agent: OPENCODE_ASSISTANT_AGENT,
        permission: scopedRules(assistantPermissionRules()),
      },
    });
    const sessionId = typeof binding === 'string' ? binding : await binding;
    if (previousSessionId === null) {
      repo.updateConversation(c.id, { opencodeSessionId: sessionId });
      log.info({ conversationId: c.id, sessionId }, 'assistant session created');
    }
    sessions.set(sessionId, c.id);
    return sessionId;
  }

  /**
   * 模型额度用满时本轮排队（D186）：先占住发送入口并显示排队，拿到额度后再开始，`onQueued` 让用户的消息先出现在对话里。
   * 没有人再等这次请求，开始时的失败写进对话。
   */
  async function runTurn(
    c: Conversation,
    source: 'user' | 'app',
    send: (model: string | null, turn: Turn) => Promise<void>,
    onQueued: () => void = () => undefined,
  ): Promise<void> {
    const state = liveOf(c.id);
    const now = slots.request({
      id: c.id,
      grant: () => {
        state.queued = false;
        beginTurn(c, source, send, true).catch((err: unknown) =>
          log.warn({ err, conversationId: c.id }, 'queued assistant turn did not start'),
        );
      },
      moved: () => publish(c.id),
    });
    if (now) {
      await beginTurn(c, source, send, false);
      return;
    }
    state.queued = true;
    state.busy = true;
    onQueued();
    publish(c.id);
  }

  /** 建会话之前占住发送入口；请求返回前的空闲事件只结束模型回合，不释放发送权。 */
  async function beginTurn(
    c: Conversation,
    source: 'user' | 'app',
    send: (model: string | null, turn: Turn) => Promise<void>,
    queued: boolean,
  ): Promise<void> {
    const state = liveOf(c.id);
    state.sending = true;
    state.busy = true;
    const messageId = createMessageId(clock.now());
    const started = usage.start(c.id, source, messageId);
    const turn: Turn = {
      intent: '',
      source,
      delegation: new AbortController(),
      confirmedStop: null,
      abortPending: null,
      request: null,
      id: started.id,
      messageId,
      completion: null,
      outcome: null,
    };
    state.turn = turn;
    publish(c.id);
    try {
      await send(started.model, turn);
    } catch (err) {
      if (state.turn === turn && !state.stopping && !state.deleting && turn.request === null) {
        state.busy = false;
        state.turn?.delegation.abort();
        state.turn = null;
        usage.finish(c.id, AssistantTurnEvent.Error);
        // Queued: nobody waits for the request; the failure belongs in the conversation.
        if (queued && err instanceof AppError)
          record(c, [{ kind: TranscriptEntryKind.Error, data: { code: err.code, message: err.message } }]);
      }
      throw err;
    } finally {
      state.sending = false;
      publish(c.id);
    }
    // 空闲事件可能早于请求响应，此时补发请求期间入队的消息。
    if (!state.busy && usage.get(c.id).latest?.status === AssistantTurnStatus.Completed) flushLater(c.id);
  }

  async function prompt(
    c: Conversation,
    sessionId: string,
    systemText: string,
    text: string,
    model: string | null,
    turn: Turn,
  ): Promise<void> {
    const request = opencode.promptAssistant({
      sessionId,
      directory: filesDir(c.id),
      messageId: turn.messageId,
      agent: OPENCODE_ASSISTANT_AGENT,
      efforts: modelEfforts(settings.getAll()),
      ...(model === null ? {} : { model: parseModelRef(model) }),
      system: systemText,
      text,
    });
    turn.request = request;
    // 两条 Promise 都立即接上处理器；前置失败可以早于接受，不能产生未处理拒绝。
    turn.completion = request.completed.then(
      (outcome) => completeTurn(c, turn, outcome),
      (requestError: unknown) => completeTurn(c, turn, { requestError }),
    );
    await request.accepted;
  }

  function completeTurn(c: Conversation, turn: Turn, outcome: TurnOutcome): void {
    turn.outcome = outcome;
    const state = live.get(c.id);
    // runtime lost、停止或旧请求迟到，不能借同一个 session 结束之后的新轮。
    if (state?.turn !== turn || state.stopping || state.deleting || turn.abortPending !== null) return;
    const failed = turn.confirmedStop === null && ('requestError' in outcome || outcome.error !== undefined);
    if (turn.confirmedStop !== null) {
      record(c, [
        {
          kind: TranscriptEntryKind.System,
          data: {
            event:
              turn.confirmedStop === AssistantTurnEvent.Timeout
                ? TranscriptSystemEvent.TimedOut
                : TranscriptSystemEvent.Aborted,
          },
        },
      ]);
    } else if ('requestError' in outcome) {
      record(c, [
        {
          kind: TranscriptEntryKind.Error,
          data: {
            code: ErrorCode.OpencodeRequestFailed,
            message: outcome.requestError instanceof Error ? outcome.requestError.message : 'Assistant request failed',
          },
        },
      ]);
    } else if (outcome.error !== undefined) {
      record(
        c,
        state.view.toEntries({
          type: OpencodeEventType.Error,
          sessionId: c.opencodeSessionId ?? '',
          error:
            outcome.error.name === 'ContextOverflowError'
              ? { ...outcome.error, data: { ...outcome.error.data, assistantTurnSource: turn.source } }
              : outcome.error,
        }),
      );
    }
    // HTTP 传输中断不证明 Runner 已结束；保持占用，用户仍可明确停止。
    if (turn.confirmedStop === null && !confirmedOutcome(outcome)) {
      publish(c.id);
      return;
    }
    usage.finish(c.id, turn.confirmedStop ?? (failed ? AssistantTurnEvent.Error : AssistantTurnEvent.Idle));
    state.turn?.delegation.abort();
    state.turn = null;
    state.busy = false;
    state.permissions.clear();
    publish(c.id);
    if (!failed && turn.confirmedStop !== AssistantTurnEvent.Timeout) flushLater(c.id);
  }

  /** Sends what waits in the outbox, once the session can take it. */
  async function flush(id: string): Promise<void> {
    const state = liveOf(id);
    if (state.busy || state.sending || state.deleting || state.stopping || !opencode.isConnected()) return;
    if (repo.pendingMessages(id).length === 0) return;
    const c = get(id);
    await runTurn(c, 'app', async (model, turn) => {
      const sessionId = await sessionOf(c);
      if (!usage.isRunning(id) || state.stopping || state.deleting)
        throw new AppError(
          ErrorCode.AssistantBusy,
          'Assistant stopped before the message was sent; your draft is retained',
        );
      const queued = repo.pendingMessages(id);
      await prompt(c, sessionId, system(c, state.page, 'app'), queued.map((m) => m.text).join('\n\n'), model, turn);
      repo.acknowledgeMessages(queued.map((m) => m.id));
    });
  }

  function flushLater(id: string): void {
    flush(id).catch((err: unknown) => log.error({ err, conversationId: id }, 'assistant message not sent'));
  }

  function queueMessage(id: string, text: string): void {
    get(id);
    repo.enqueueMessage(id, text, clock.now());
  }

  function onToolEvent(
    c: Conversation,
    state: Live,
    event: Extract<OpencodeEvent, { type: typeof OpencodeEventType.Tool }>,
  ): void {
    if (event.status !== ToolCallStatus.Completed || !FILE_WRITING_TOOLS.has(event.tool)) return;
    const { filePath } = event.input;
    if (typeof filePath !== 'string') return;
    const path = relative(filesDir(c.id), resolve(filesDir(c.id), filePath));
    if (path.startsWith('..') || isAbsolute(path) || state.attached.has(path)) return;
    state.attached.add(path);
    record(c, [{ kind: TranscriptEntryKind.Attachment, data: { path } }]);
  }

  function onRuntimeLost(): void {
    for (const [id, state] of live) {
      state.permissions.clear();
      if (!state.busy) continue;
      slots.cancel(id);
      state.queued = false;
      state.busy = false;
      usage.finish(id, AssistantTurnEvent.RuntimeLost);
      state.turn?.delegation.abort();
      state.turn = null;
      record(get(id), [{ kind: TranscriptEntryKind.System, data: { event: TranscriptSystemEvent.RuntimeLost } }]);
      publish(id);
    }
  }

  function completePermission(id: string, permissionId: string): void {
    const state = liveOf(id);
    if (!state.permissions.delete(permissionId)) return;
    if (state.permissions.size === 0 && state.deciding.size === 0) usage.resume(id);
    publish(id);
  }

  function permissionRequest(
    c: Conversation,
    state: Live,
    turn: Turn,
    event: Extract<OpencodeEvent, { type: typeof OpencodeEventType.PermissionAsked }>,
  ) {
    const deciding = state.deciding;
    if (deciding.has(event.permissionId) || state.permissions.has(event.permissionId)) return;
    const controller = new AbortController();
    deciding.set(event.permissionId, controller);
    const signal = AbortSignal.any([controller.signal, turn.delegation.signal]);
    function ask(reason?: string) {
      state.permissions.set(event.permissionId, {
        permissionId: event.permissionId,
        permission: event.permission,
        patterns: event.patterns,
        ...(reason ? { reason } : {}),
      });
      publish(c.id);
    }
    const run = async () => {
      const result =
        c.permissionMode === PermissionMode.Ask && state.grants.has(grantKey(event))
          ? { reply: PermissionDecision.Once, reason: undefined }
          : await deps.permissionReviewer.native({
              event,
              call:
                c.permissionMode === PermissionMode.Assisted
                  ? await state.view.permissionCall(event.callId, clock, signal)
                  : undefined,
              directory: filesDir(c.id),
              intent: turn.intent,
              mode: c.permissionMode,
              mutable: true,
              parentSignal: turn.delegation.signal,
              baselineRules: assistantPermissionRules(),
              signal,
            });
      if (signal.aborted || state.turn !== turn) return;
      if (result.reason)
        record(c, [
          {
            kind: TranscriptEntryKind.System,
            data: {
              event: TranscriptSystemEvent.PermissionReview,
              detail: [
                event.permission,
                result.reply && get(c.id).permissionMode === c.permissionMode ? '批准本次' : '询问你',
                result.reason,
              ].join(' · '),
            },
          },
        ]);
      if (!result.reply || get(c.id).permissionMode !== c.permissionMode) {
        ask(result.reason);
        return;
      }
      await opencode.replyPermission({
        permissionId: event.permissionId,
        directory: filesDir(c.id),
        reply: result.reply,
      });
    };
    void run()
      .catch((err: unknown) => {
        if (
          signal.aborted ||
          state.turn !== turn ||
          (err instanceof AppError && err.code === ErrorCode.PermissionRequestExpired)
        )
          return;
        log.warn({ err, conversationId: c.id }, 'permission reply failed');
        ask();
      })
      .finally(() => {
        if (deciding.get(event.permissionId) === controller) deciding.delete(event.permissionId);
        if (state.turn === turn && !state.permissions.size && !deciding.size) usage.resume(c.id);
      });
  }
  function onEvent(event: OpencodeEvent): void {
    if (event.type === OpencodeEventType.RuntimeLost) {
      onRuntimeLost();
      return;
    }
    const id = sessions.get(event.sessionId);
    if (id === undefined) return;
    const c = get(id);
    const state = liveOf(id);
    // 裸 session 终止事件没有请求 id；原生 abort 甚至会发多个迟到 Idle。
    // 真实错误与结束统一由本轮同步 HTTP 的 completed 处理。
    if (event.type === OpencodeEventType.Error || event.type === OpencodeEventType.Idle) return;
    record(c, state.view.toEntries(event));
    if (event.type === OpencodeEventType.Retry) usage.waitForModel(id);
    else usage.modelAnswering(id);
    switch (event.type) {
      case OpencodeEventType.Message:
        if (event.role === 'assistant') usage.message(id, event.messageId, event.parentMessageId);
        return;
      case OpencodeEventType.StepFinished:
        if (usage.step(id, event.messageId, event.partId, event.tokens)) publish(id);
        return;
      case OpencodeEventType.Tool:
        onToolEvent(c, state, event);
        return;
      case OpencodeEventType.PermissionAsked:
        if (state.turn === null || (event.messageId !== undefined && !usage.ownsActiveMessage(id, event.messageId)))
          return;
        usage.pause(id);
        permissionRequest(c, state, state.turn, event);
        return;
      case OpencodeEventType.PermissionReplied:
        state.deciding.get(event.permissionId)?.abort();
        completePermission(id, event.permissionId);
        return;
      default:
        return;
    }
  }

  opencode.subscribe(onEvent);

  function confirmedOutcome(outcome: TurnOutcome | null): boolean {
    return (
      outcome !== null &&
      (!('requestError' in outcome) ||
        (outcome.requestError instanceof AppError && outcome.requestError.details?.responseReceived === true))
    );
  }

  /** 只有确认 Runner 已注册才发一次 abort；整个停止确认有界，失败保留占用供用户重试。 */
  async function stopRequest(
    c: Conversation,
    turn: Turn | null,
    reason: typeof AssistantTurnEvent.Abort | typeof AssistantTurnEvent.Timeout,
  ): Promise<void> {
    if (turn === null || turn.request === null || turn.completion === null) return;
    const request = turn.request;
    const currentTurn = turn;
    const completion = turn.completion;
    const deadline = Promise.withResolvers<never>();
    let expired = false;
    let cancelPoll: () => void = () => undefined;
    let wakePoll: () => void = () => undefined;
    const cancelDeadline = clock.schedule(10_000, () => {
      expired = true;
      deadline.reject(
        new AppError(ErrorCode.OpencodeRequestFailed, 'Assistant stop could not be confirmed; retry stopping'),
      );
      wakePoll();
    });
    const confirmed = completion.then(() =>
      confirmedOutcome(currentTurn.outcome) ? undefined : new Promise<never>(() => undefined),
    );
    async function stop() {
      if (currentTurn.abortPending !== null) {
        await currentTurn.abortPending;
        return;
      }
      while (!expired && !confirmedOutcome(turn?.outcome ?? null)) {
        // busy/retry 来自原生实例的状态，不把 idle 或旧 SSE 视为成功。
        const running = await Promise.race([
          request.isRunning(),
          request.started.then(() => true),
          confirmed.then(() => false),
        ]);
        if (expired || confirmedOutcome(turn?.outcome ?? null)) return;
        if (running) {
          const aborting = opencode
            .abort({ sessionId: c.opencodeSessionId ?? '', directory: filesDir(c.id) })
            .then(() => {
              currentTurn.confirmedStop = reason;
              return completion;
            });
          currentTurn.abortPending = aborting;
          try {
            await aborting;
          } finally {
            currentTurn.abortPending = null;
            if (currentTurn.outcome !== null) completeTurn(c, currentTurn, currentTurn.outcome);
          }
          return;
        }
        await Promise.race([
          request.started,
          confirmed,
          new Promise<void>((resolve) => {
            wakePoll = resolve;
            cancelPoll = clock.schedule(250, resolve);
          }),
        ]);
        cancelPoll();
      }
    }
    try {
      await Promise.race([stop(), deadline.promise]);
    } finally {
      expired = true;
      cancelDeadline();
      cancelPoll();
      wakePoll();
    }
  }

  /** 中止请求尚未完成时仍锁住发送入口，避免旧会话结束事件落到下一轮。 */
  async function stopTurn(id: string, reason: typeof AssistantTurnEvent.Abort | typeof AssistantTurnEvent.Timeout) {
    const c = get(id);
    const state = liveOf(id);
    if (state.deleting) throw new AppError(ErrorCode.AssistantBusy, `Conversation ${id} is being deleted`, { id });
    if ((!state.busy && !state.sending) || state.stopping) return;
    if (state.queued) {
      slots.cancel(id);
      state.queued = false;
      state.busy = false;
      record(c, [{ kind: TranscriptEntryKind.System, data: { event: TranscriptSystemEvent.Aborted } }]);
      publish(id);
      return;
    }
    const turn = state.turn;
    state.stopping = true;
    state.aborting = true;
    turn?.delegation.abort();
    usage.pause(id);
    publish(id);
    try {
      await stopRequest(c, turn, reason);
      if (state.turn !== turn) return;
      usage.finish(id, reason);
      state.turn?.delegation.abort();
      state.turn = null;
      record(c, [
        {
          kind: TranscriptEntryKind.System,
          data: {
            event:
              reason === AssistantTurnEvent.Timeout ? TranscriptSystemEvent.TimedOut : TranscriptSystemEvent.Aborted,
          },
        },
      ]);
      state.busy = false;
      state.permissions.clear();
    } catch (err) {
      record(c, [
        {
          kind: TranscriptEntryKind.Error,
          data: {
            code: ErrorCode.OpencodeRequestFailed,
            message: 'Assistant stop failed; retry stopping before sending another message',
          },
        },
      ]);
      throw err;
    } finally {
      state.stopping = false;
      state.aborting = false;
      if (turn?.outcome !== null && turn?.outcome !== undefined) completeTurn(c, turn, turn.outcome);
      publish(id);
    }
    // 保留用户停止后的应用通知接力；超时不自动开始下一轮。
    if (reason === AssistantTurnEvent.Abort) flushLater(id);
  }

  return {
    async approveWrite(id: string, operationId: string, input: Record<string, unknown>) {
      const c = get(id);
      if (c.permissionMode === PermissionMode.Full) return true;
      if (c.permissionMode === PermissionMode.Ask) return settings.get('assistant.alwaysAllow').includes(operationId);
      const state = liveOf(id),
        turn = state.turn;
      if (c.permissionMode !== PermissionMode.Assisted || !turn?.intent) return false;
      // 只允许创建可撤销的本地草稿进入自动审查。发布、删除、设置和未知写操作继续出确认卡。
      if (operationId !== 'tasks.create' || input.start !== false || input.projectId !== c.projectId) return false;
      const result = await deps.permissionReviewer.review(turn.intent, { operationId, input }, turn.delegation.signal);
      if (state.turn !== turn || turn.delegation.signal.aborted || get(id).permissionMode !== PermissionMode.Assisted)
        return false;
      record(c, [
        {
          kind: TranscriptEntryKind.System,
          data: {
            event: TranscriptSystemEvent.PermissionReview,
            detail: [operationId, result.decision === 'once' ? '批准本次' : '询问你', result.reason].join(' · '),
          },
        },
      ]);
      return result.decision === 'once';
    },
    delegationSignal(id: string, sessionId: string): AbortSignal | undefined {
      const state = live.get(id);
      const signal = state?.turn?.delegation.signal;
      if (sessions.get(sessionId) !== id || state?.busy !== true || signal?.aborted !== false) return undefined;
      return signal;
    },
    get: (id: string): AssistantConversationDTO => toDto(get(id)),
    /** The MCP servers the user added to opencode themself (28 §4); the app's own two are not theirs to manage. */
    async externalMcp(): Promise<ExternalMcpServerDTO[]> {
      const servers = await opencode.mcpStatus(directory);
      return Object.entries(servers)
        .filter(([name]) => name !== MCP_SERVER_NAME && name !== MCP_ASSISTANT_SERVER_NAME)
        .map(([name, { status, error }]) => ({ name, status, error: error ?? null }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    list: (): AssistantConversationDTO[] => {
      const conversations = repo.listConversations();
      const summaries = usage.summaries(conversations.map((c) => c.id));
      const ids = new Set(conversations.map((c) => c.id));
      const continuations = new Map(repo.listContinuations().map((c) => [c.conversationId, c]));
      return conversations.map((c) => {
        const summary = summaries.get(c.id);
        if (summary === undefined) throw new Error('Missing assistant usage summary');
        const continuation = continuations.get(c.id);
        return toDto(c, summary, {
          continuation,
          sourceAvailable: continuation !== undefined && ids.has(continuation.sourceConversationId),
        });
      });
    },
    dispose: usage.dispose,
    /** The conversation an assistant MCP call comes from (15 §2). */
    findBySession: (sessionId: string): Conversation | undefined => repo.findBySession(sessionId),
    filesDir,

    setPermissionMode(id: string, permissionMode: PermissionMode) {
      get(id);
      repo.updateConversation(id, { permissionMode, updatedAt: clock.now() });
      return publish(id);
    },
    create(
      title: string | undefined,
      projectId?: string | null,
      permissionMode: PermissionMode = PermissionMode.Ask,
    ): AssistantConversationDTO {
      if (projectId != null) deps.projects.getRecord(projectId);
      const now = clock.now();
      const id = randomUUID();
      repo.insertConversation({
        id,
        title: title ?? '',
        permissionMode,
        projectId: projectId ?? null,
        opencodeSessionId: null,
        isolated: true,
        retiredSessionId: null,
        createdAt: now,
        updatedAt: now,
      });
      log.info({ conversationId: id }, 'assistant conversation created');
      return publish(id);
    },

    async continueConversation({
      id,
      requestId,
      attachmentIds,
    }: {
      id: string;
      requestId: string;
      attachmentIds: string[];
    }): Promise<AssistantConversationDTO> {
      const priorRequest = () => {
        const existing = repo.findContinuationByRequest(requestId);
        if (existing !== undefined) {
          if (existing.sourceConversationId !== id)
            throw new AppError(ErrorCode.ValidationFailed, 'Request belongs to another source');
          return toDto(get(existing.conversationId));
        }
        return undefined;
      };
      const existing = priorRequest();
      if (existing !== undefined) return existing;
      const availableSource = () => {
        const source = get(id);
        const state = liveOf(id);
        if (state.busy || state.sending || state.deleting || state.stopping)
          throw new AppError(ErrorCode.AssistantBusy, `Conversation ${id} is busy`, { id });
        return source;
      };
      const source = availableSource();
      const previous = repo.findContinuation(id);
      const own = new Set(attachments.listByOwner({ kind: AttachmentOwnerKind.AssistantMessage, id }).map((a) => a.id));
      if (attachmentIds.some((attachmentId) => !own.has(attachmentId)))
        throw new AppError(ErrorCode.AttachmentNotFound, 'Not attachments of this conversation');
      const entries: TranscriptEntry[] = [];
      let afterSeq = 0;
      try {
        for await (const entry of transcripts.snapshot(source)) {
          afterSeq = entry.seq;
          if (
            entry.kind === TranscriptEntryKind.UserMessage ||
            entry.kind === TranscriptEntryKind.Text ||
            entry.kind === TranscriptEntryKind.EntityRef ||
            entry.kind === TranscriptEntryKind.Error
          )
            entries.push(entry);
        }
      } catch (err) {
        // 源对话在文件打开前被删除时，返回对话已删除的领域错误。
        get(id);
        throw err;
      }
      const concurrent = priorRequest();
      if (concurrent !== undefined) return concurrent;
      availableSource();
      const handoff = continuationContext(entries, previous?.handoffText);
      const lastUserIndex = entries.findLastIndex((entry) => entry.kind === TranscriptEntryKind.UserMessage);
      const lastUser = entries[lastUserIndex];
      const overflow =
        lastUserIndex >= 0 &&
        entries
          .slice(lastUserIndex + 1)
          .some(
            (entry) =>
              entry.kind === TranscriptEntryKind.Error &&
              entry.data.details?.opencodeErrorName === 'ContextOverflowError' &&
              entry.data.details.assistantTurnSource !== 'app',
          );
      const draftText =
        overflow && lastUser?.kind === TranscriptEntryKind.UserMessage
          ? lastUser.data.text
          : lastUserIndex < 0
            ? (previous?.draftText ?? null)
            : null;
      const now = clock.now();
      const childId = randomUUID();
      unit.transact(() => {
        repo.insertConversation({
          id: childId,
          title: source.title,
          projectId: source.projectId,
          opencodeSessionId: null,
          isolated: true,
          retiredSessionId: null,
          createdAt: now,
          updatedAt: now,
        });
        repo.insertContinuation({
          conversationId: childId,
          sourceConversationId: id,
          requestId,
          cutoffSeq: afterSeq,
          handoffText: handoff.text,
          handoffKind: handoff.kind,
          attachmentIds,
          draftText,
          createdAt: now,
          consumedAt: null,
        });
        attachments.bind({ kind: AttachmentOwnerKind.AssistantMessage, id: childId }, attachmentIds, source.projectId);
      });
      return publish(childId);
    },

    continuationHistory(id: string, afterSeq: number): TranscriptPage {
      get(id);
      const continuation = repo.findContinuation(id);
      if (continuation === undefined) throw new AppError(ErrorCode.NotFound, 'Conversation has no source');
      const source = get(continuation.sourceConversationId);
      return transcripts.read(source, Math.min(afterSeq, continuation.cutoffSeq), true, continuation.cutoffSeq);
    },

    listAttachments(id: string): AttachmentDTO[] {
      get(id);
      return attachments.listByOwner({ kind: AttachmentOwnerKind.AssistantMessage, id });
    },

    /** 先清理运行时资源；外部删除失败则保留本地记录，用户可在恢复后重试。 */
    async delete(id: string): Promise<void> {
      const c = get(id);
      const state = liveOf(id);
      if (state.sending || state.deleting || state.stopping)
        throw new AppError(ErrorCode.AssistantBusy, `Conversation ${id} is busy`, { id });
      const turn = state.turn;
      if (state.queued) {
        slots.cancel(id);
        state.queued = false;
        state.busy = false;
      }
      state.deleting = true;
      turn?.delegation.abort();
      usage.pause(id);
      try {
        if (c.opencodeSessionId !== null) {
          if (state.busy) {
            state.aborting = true;
            await stopRequest(c, turn, AssistantTurnEvent.Abort);
            usage.finish(id, AssistantTurnEvent.Abort);
            state.turn?.delegation.abort();
            state.turn = null;
            state.busy = false;
            state.permissions.clear();
            record(c, [{ kind: TranscriptEntryKind.System, data: { event: TranscriptSystemEvent.Aborted } }]);
          }
          await opencode.deleteSession({
            sessionId: c.opencodeSessionId,
            directory: c.isolated ? filesDir(id) : directory,
          });
        }
        if (c.retiredSessionId !== null) await opencode.deleteSession({ sessionId: c.retiredSessionId, directory });
        usage.finish(id, AssistantTurnEvent.Abort);
        unit.transact(() => {
          attachments.release(AttachmentOwnerKind.AssistantMessage, [id]);
          repo.deleteConversation(id);
        });
        await deps
          .cleanupDatabaseInvestigations()
          .catch((err: unknown) => log.warn({ err, conversationId: id }, 'database investigation cleanup failed'));
        for (const continuation of repo.listContinuations()) {
          if (continuation.sourceConversationId === id) publish(continuation.conversationId);
        }
        if (c.opencodeSessionId !== null) sessions.delete(c.opencodeSessionId);
        live.delete(id);
        transcripts.forget(c);
        rmSync(join(directory, ASSISTANT_CONVERSATIONS_DIR, `${id}.jsonl`), { force: true });
        rmSync(filesDir(id), { recursive: true, force: true });
        log.info({ conversationId: id }, 'assistant conversation deleted');
      } finally {
        state.aborting = false;
        state.deleting = false;
        if (live.has(id)) {
          if (turn?.outcome !== null && turn?.outcome !== undefined) completeTurn(c, turn, turn.outcome);
          if (state.busy && state.permissions.size === 0 && state.deciding.size === 0) usage.resume(id);
          publish(id);
        }
      }
    },

    /** A user message, with the page they are on (15 §2). Messages waiting in the outbox go along with it. */
    async send({
      id,
      text,
      context: page,
      attachmentIds = [],
      skillIds = [],
    }: SendAssistantMessageRequest): Promise<AssistantConversationDTO> {
      const c = get(id);
      const state = liveOf(id);
      if (state.busy || state.sending || state.deleting || state.stopping)
        throw new AppError(ErrorCode.AssistantBusy, `Conversation ${id} is busy`, { id });
      if (!opencode.isConnected()) throw new AppError(ErrorCode.OpencodeNotReady, 'opencode is not ready');
      // Rendered first: a page about a deleted entity fails before anything is recorded.
      const skills = deps.skills.selected(skillIds);
      const systemText = withUserSkills(system(c, page, 'user'), skills);
      const titled = c.title === '' ? { ...c, title: titleOf(text) } : c;
      repo.updateConversation(id, { title: titled.title, updatedAt: clock.now() });
      let shown: AttachmentDTO[] | undefined;
      // The message joins the conversation once sent, or right away when the turn waits for a model slot (D186).
      const show = (): AttachmentDTO[] => {
        if (shown !== undefined) return shown;
        // The conversation keeps its files even when the model cannot be reached: they were sent (30 §2).
        attachments.bind({ kind: AttachmentOwnerKind.AssistantMessage, id }, attachmentIds, c.projectId);
        const sent = attachmentIds.map((attachmentId) => attachments.get(attachmentId));
        record(c, [
          {
            kind: TranscriptEntryKind.UserMessage,
            data: {
              text,
              ...(sent.length === 0 ? {} : { attachments: sent.map((a) => ({ id: a.id, name: a.name })) }),
              ...(skills.length === 0
                ? {}
                : { skills: skills.map(({ id, name, version }) => ({ id, name, version })) }),
            },
          },
        ]);
        shown = sent;
        return sent;
      };
      await runTurn(
        titled,
        'user',
        async (model, turn) => {
          const sessionId = await sessionOf(titled);
          if (!usage.isRunning(id) || state.stopping || state.deleting)
            throw new AppError(
              ErrorCode.AssistantBusy,
              'Assistant stopped before the message was sent; your draft is retained',
            );
          turn.intent = text;
          const sent = show();
          state.page = page;
          const queued = repo.pendingMessages(id);
          const continuation = repo.findContinuation(id);
          const inherited =
            continuation !== undefined && continuation.consumedAt === null
              ? continuation.attachmentIds.map((attachmentId) => attachments.get(attachmentId))
              : [];
          const selected = [...new Map([...inherited, ...sent].map((a) => [a.id, a])).values()];
          const section = attachments.promptSection(selected, MCP_ASSISTANT_TOOL_PREFIX);
          const memory = deps.memory.context(c.projectId, text);
          const turnSystem = memory === '' ? systemText : `${systemText}\n\n${memory}`;
          const updates = queued.map((m) => m.text);
          const handoff =
            continuation !== undefined && continuation.consumedAt === null && continuation.handoffText !== ''
              ? fitContinuation(
                  continuation.handoffText,
                  await continuationBudget(opencode, model, turnSystem, [...updates, text, section].join('\n\n')),
                )
              : '';
          if (!usage.isRunning(id) || state.stopping || state.deleting)
            throw new AppError(
              ErrorCode.AssistantBusy,
              'Assistant stopped before the message was sent; your draft is retained',
            );
          await prompt(
            c,
            sessionId,
            turnSystem,
            [...updates, ...(handoff === '' ? [] : [handoff]), text, ...(section === '' ? [] : [section])].join('\n\n'),
            model,
            turn,
          );
          repo.acknowledgeMessages(queued.map((m) => m.id));
          if (continuation !== undefined && continuation.consumedAt === null) repo.consumeContinuation(id, clock.now());
        },
        show,
      );
      return toDto(get(id));
    },

    /**
     * The assistant passes on only files the user attached in this conversation (30 §2.2): an id from elsewhere is
     * answered as if it did not exist.
     */
    assertOwnAttachments(conversationId: string, attachmentIds: readonly string[]): void {
      const own = new Set(
        attachments.listByOwner({ kind: AttachmentOwnerKind.AssistantMessage, id: conversationId }).map((a) => a.id),
      );
      const foreign = attachmentIds.filter((id) => !own.has(id));
      if (foreign.length > 0) {
        throw new AppError(ErrorCode.AttachmentNotFound, 'Not attachments of this conversation', { ids: foreign });
      }
    },

    /** A message from the app (a confirmation's result): now if the session can take it, else when it can. */
    async deliver(id: string, text: string): Promise<void> {
      queueMessage(id, text);
      await flush(id);
    },
    /** 确认结果与待发消息由调用者在同一事务提交，提交后才能发送。 */
    queueMessage,
    flush,

    async abort(id: string): Promise<AssistantConversationDTO> {
      await stopTurn(id, AssistantTurnEvent.Abort);
      return toDto(get(id));
    },

    async replyPermission(
      id: string,
      permissionId: string,
      reply: PermissionDecision,
    ): Promise<AssistantConversationDTO> {
      get(id);
      const state = liveOf(id);
      const pending = state.permissions.get(permissionId);
      if (!pending) {
        throw new AppError(ErrorCode.NotFound, `No open permission request ${permissionId}`, { permissionId });
      }
      try {
        await opencode.replyPermission({
          permissionId,
          directory: filesDir(id),
          reply: reply === PermissionDecision.Always ? PermissionDecision.Once : reply,
        });
        if (reply === PermissionDecision.Always) state.grants.add(grantKey(pending));
      } catch (error) {
        if (error instanceof AppError && error.code === ErrorCode.PermissionRequestExpired)
          completePermission(id, permissionId);
        throw error;
      }
      completePermission(id, permissionId);
      return toDto(get(id));
    },

    history(id: string, before?: number) {
      return readAssistantHistory(transcriptFile(get(id)), before);
    },

    transcript(id: string, afterSeq: number): TranscriptPage {
      // A conversation never ends: readers keep following it.
      return transcripts.read(get(id), afterSeq, false);
    },

    /**
     * A file of this conversation by its path relative to the files directory: paths come from the model and the
     * user (06 §11), so anything outside it, through a symbolic link too, or not a file is `VALIDATION_FAILED`.
     */
    fileOf(id: string, path: string): string {
      get(id);
      const absolutePath = resolve(filesDir(id), path);
      if (!existsSync(absolutePath) || !within(id, realpathSync(absolutePath)) || !statSync(absolutePath).isFile()) {
        throw new AppError(ErrorCode.ValidationFailed, `${path} is not a file of this conversation`, {
          issues: [{ path: ['path'], message: 'not a file of this conversation; call list_files' }],
        });
      }
      return absolutePath;
    },

    /**
     * Where a new file asked for at `path` goes (39 §7.2): inside the files directory, its folders made; a taken name
     * gets a number before the extension (「周报 (2).docx」), so nothing is overwritten. The folder it lands in must be
     * inside the directory once symbolic links are followed: the worker writes through them.
     */
    newFile(id: string, path: string): { path: string; absolutePath: string } {
      get(id);
      const dir = filesDir(id);
      const wanted = resolve(dir, path);
      const outside = () =>
        new AppError(ErrorCode.ValidationFailed, `${path} is outside this conversation's files directory`, {
          issues: [{ path: ['file'], message: 'a path inside the files directory, such as report.docx' }],
        });
      const inside = relative(dir, wanted);
      if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) throw outside();
      // The nearest folder that exists decides where the missing ones are made.
      let existing = dirname(wanted);
      while (!existsSync(existing)) existing = dirname(existing);
      if (!within(id, realpathSync(existing))) throw outside();
      mkdirSync(dirname(wanted), { recursive: true });
      const extension = extname(wanted);
      const stem = wanted.slice(0, wanted.length - extension.length);
      let absolutePath = wanted;
      // lstat: a link that points nowhere still takes the name (the worker's `wx` would fail on it).
      for (let n = 2; lstatSync(absolutePath, { throwIfNoEntry: false }) !== undefined; n++) {
        absolutePath = `${stem} (${n})${extension}`;
      }
      return { path: relative(dir, absolutePath), absolutePath };
    },

    /** A file the assistant wrote with an app tool: a card in the message stream, like one its own tools wrote. */
    recordFile(id: string, path: string, lost: readonly OfficeLossItem[]): void {
      live.get(id)?.attached.add(path);
      record(get(id), [
        { kind: TranscriptEntryKind.Attachment, data: lost.length === 0 ? { path } : { path, lost: [...lost] } },
      ]);
    },

    files(id: string): AssistantFileDTO[] {
      get(id);
      const dir = filesDir(id);
      if (!existsSync(dir)) return [];
      return readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const absolutePath = join(entry.parentPath, entry.name);
          const stat = statSync(absolutePath);
          return { path: relative(dir, absolutePath), absolutePath, size: stat.size, modifiedAt: stat.mtimeMs };
        })
        .sort((a, b) => a.path.localeCompare(b.path));
    },

    /** Records a confirmation card in the conversation's message stream (15 §4). */
    recordConfirmation(id: string, confirmationId: string): void {
      record(get(id), [{ kind: TranscriptEntryKind.Confirmation, data: { confirmationId } }]);
    },

    /** An operation the assistant ran produced an object: a navigation card in the conversation (D66). */
    recordProduced(id: string, contract: OperationContract, output: unknown): void {
      const entity = producedEntity(contract, output);
      if (entity !== undefined) record(get(id), [{ kind: TranscriptEntryKind.EntityRef, data: entity }]);
    },

    /** The assistant drew a chart: it stays in the conversation's message stream (35 §4, D139). */
    recordChart(id: string, chart: ChartSpec): void {
      record(get(id), [{ kind: TranscriptEntryKind.Chart, data: { chart } }]);
    },
  };
}
export type AssistantService = ReturnType<typeof createAssistantService>;
