import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
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
  AssistantToolName,
  AttachmentOwnerKind,
  ErrorCode,
  MCP_ASSISTANT_TOOL_PREFIX,
  OPENCODE_ASSISTANT_AGENT,
  type OperationContract,
  type PermissionDecision,
  producedEntity,
  type SendAssistantMessageRequest,
  ServerEventType,
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
import {
  assistantPermissionRules,
  type OpencodeClient,
  type OpencodeEvent,
  OpencodeEventType,
  parseModelRef,
  ToolCallStatus,
} from '../opencode/index.ts';
import type { SettingsService } from '../settings/index.ts';
import { type ContextRenderer, localTime } from './assistant.context.ts';
import { recoveryContext } from './assistant.recovery-context.ts';
import { type Conversation, createAssistantRepo } from './assistant.repo.ts';

export type AssistantServiceDeps = {
  db: Db;
  unit: UnitOfWork;
  events: EventBus;
  clock: Clock;
  log: Logger;
  opencode: OpencodeClient;
  settings: SettingsService;
  attachments: AttachmentsService;
  context: ContextRenderer;
  dataDir: string;
  /** IANA zone the user's times are given in (15 §2). */
  timeZone: string;
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
  view: SessionView;
  permissions: Map<string, AssistantPermissionRequestDTO>;
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
  const { db, unit, events, clock, log, opencode, settings, attachments, context } = deps;
  const repo = createAssistantRepo(db);
  // opencode 使用真实路径判断目录边界，macOS 的 /var 等别名也必须先规范化。
  const directory = join(realpathSync(deps.dataDir), ASSISTANT_DIR);
  const live = new Map<string, Live>();
  /** opencode session id → conversation id, for the sessions this run has used. */
  const sessions = new Map<string, string>();
  const transcripts = createTranscriptStore<{ id: string }>({
    fileOf: (c) => join(directory, ASSISTANT_CONVERSATIONS_DIR, `${c.id}.jsonl`),
    onAppend: (c, entries) =>
      events.publish({ type: ServerEventType.AssistantTranscript, data: { conversationId: c.id, entries } }),
    clock,
  });

  const filesDir = (id: string) => join(directory, ASSISTANT_FILES_DIR, id);

  function liveOf(id: string): Live {
    let state = live.get(id);
    if (state === undefined) {
      state = {
        busy: false,
        sending: false,
        deleting: false,
        aborting: false,
        view: createSessionView(),
        permissions: new Map(),
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

  function toDto(c: Conversation): AssistantConversationDTO {
    const state = liveOf(c.id);
    return {
      id: c.id,
      title: c.title,
      busy: state.busy || state.sending || state.deleting,
      pendingPermissions: [...state.permissions.values()],
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
    if (current.opencodeSessionId !== null) {
      sessions.set(current.opencodeSessionId, c.id);
      return current.opencodeSessionId;
    }
    mkdirSync(filesDir(c.id), { recursive: true });
    const sessionId = await opencode.createSession({
      directory: filesDir(c.id),
      title: `Assistant · ${c.title}`,
      agent: OPENCODE_ASSISTANT_AGENT,
      permission: assistantPermissionRules(),
    });
    repo.updateConversation(c.id, { opencodeSessionId: sessionId });
    sessions.set(sessionId, c.id);
    log.info({ conversationId: c.id, sessionId }, 'assistant session created');
    return sessionId;
  }

  /** 建会话之前占住发送入口；请求返回前的空闲事件只结束模型回合，不释放发送权。 */
  async function runTurn(c: Conversation, send: () => Promise<void>): Promise<void> {
    const state = liveOf(c.id);
    state.sending = true;
    state.busy = true;
    publish(c.id);
    try {
      await send();
    } catch (err) {
      state.busy = false;
      throw err;
    } finally {
      state.sending = false;
      publish(c.id);
    }
    // 空闲事件可能早于请求响应，此时补发请求期间入队的消息。
    if (!state.busy) flushLater(c.id);
  }

  async function prompt(c: Conversation, sessionId: string, systemText: string, text: string): Promise<void> {
    const model = settings.get('ai.defaultModel');
    await opencode.prompt({
      sessionId,
      directory: filesDir(c.id),
      agent: OPENCODE_ASSISTANT_AGENT,
      ...(model === null ? {} : { model: parseModelRef(model) }),
      system: systemText,
      text,
    });
  }

  /** Sends what waits in the outbox, once the session can take it. */
  async function flush(id: string): Promise<void> {
    const state = liveOf(id);
    if (state.busy || state.sending || state.deleting || !opencode.isConnected()) return;
    if (repo.pendingMessages(id).length === 0) return;
    const c = get(id);
    await runTurn(c, async () => {
      const sessionId = await sessionOf(c);
      const queued = repo.pendingMessages(id);
      await prompt(c, sessionId, system(c, state.page, 'app'), queued.map((m) => m.text).join('\n\n'));
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
      state.busy = false;
      record(get(id), [{ kind: TranscriptEntryKind.System, data: { event: TranscriptSystemEvent.RuntimeLost } }]);
      publish(id);
    }
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
    if (event.type === OpencodeEventType.Error && state.aborting) {
      record(c, [{ kind: TranscriptEntryKind.System, data: { event: TranscriptSystemEvent.Aborted } }]);
    } else {
      record(c, state.view.toEntries(event));
    }
    switch (event.type) {
      case OpencodeEventType.Tool:
        onToolEvent(c, state, event);
        return;
      case OpencodeEventType.PermissionAsked:
        state.permissions.set(event.permissionId, {
          permissionId: event.permissionId,
          permission: event.permission,
          patterns: event.patterns,
        });
        publish(id);
        return;
      // A session error ends the turn like idle does; opencode does not always follow it with an idle event.
      case OpencodeEventType.Error:
      case OpencodeEventType.Idle:
        if (!state.busy) return;
        state.busy = false;
        state.aborting = false;
        state.permissions.clear();
        publish(id);
        flushLater(id);
        return;
      default:
        return;
    }
  }

  opencode.subscribe(onEvent);

  return {
    get: (id: string): AssistantConversationDTO => toDto(get(id)),
    list: (): AssistantConversationDTO[] => repo.listConversations().map(toDto),
    /** The conversation an assistant MCP call comes from (15 §2). */
    findBySession: (sessionId: string): Conversation | undefined => repo.findBySession(sessionId),
    filesDir,

    create(title: string | undefined): AssistantConversationDTO {
      const now = clock.now();
      const id = randomUUID();
      repo.insertConversation({
        id,
        title: title ?? '',
        opencodeSessionId: null,
        isolated: true,
        retiredSessionId: null,
        createdAt: now,
        updatedAt: now,
      });
      log.info({ conversationId: id }, 'assistant conversation created');
      return publish(id);
    },

    /** 先清理运行时资源；外部删除失败则保留本地记录，用户可在恢复后重试。 */
    async delete(id: string): Promise<void> {
      const c = get(id);
      const state = liveOf(id);
      if (state.sending || state.deleting)
        throw new AppError(ErrorCode.AssistantBusy, `Conversation ${id} is busy`, { id });
      state.deleting = true;
      try {
        if (c.opencodeSessionId !== null) {
          if (state.busy) {
            state.aborting = true;
            await opencode.abort({ sessionId: c.opencodeSessionId, directory: filesDir(id) });
          }
          await opencode.deleteSession({
            sessionId: c.opencodeSessionId,
            directory: c.isolated ? filesDir(id) : directory,
          });
        }
        if (c.retiredSessionId !== null) await opencode.deleteSession({ sessionId: c.retiredSessionId, directory });
        unit.transact(() => {
          attachments.release(AttachmentOwnerKind.AssistantMessage, [id]);
          repo.deleteConversation(id);
        });
        if (c.opencodeSessionId !== null) sessions.delete(c.opencodeSessionId);
        live.delete(id);
        transcripts.forget(c);
        rmSync(join(directory, ASSISTANT_CONVERSATIONS_DIR, `${id}.jsonl`), { force: true });
        rmSync(filesDir(id), { recursive: true, force: true });
        log.info({ conversationId: id }, 'assistant conversation deleted');
      } finally {
        state.aborting = false;
        state.deleting = false;
        if (live.has(id)) publish(id);
      }
    },

    /** A user message, with the page they are on (15 §2). Messages waiting in the outbox go along with it. */
    async send({
      id,
      text,
      context: page,
      attachmentIds = [],
    }: SendAssistantMessageRequest): Promise<AssistantConversationDTO> {
      const c = get(id);
      const state = liveOf(id);
      if (state.busy || state.sending || state.deleting)
        throw new AppError(ErrorCode.AssistantBusy, `Conversation ${id} is busy`, { id });
      if (!opencode.isConnected()) throw new AppError(ErrorCode.OpencodeNotReady, 'opencode is not ready');
      // Rendered first: a page about a deleted entity fails before anything is recorded.
      const systemText = system(c, page, 'user');
      const titled = c.title === '' ? { ...c, title: titleOf(text) } : c;
      repo.updateConversation(id, { title: titled.title, updatedAt: clock.now() });
      await runTurn(titled, async () => {
        const sessionId = await sessionOf(titled);
        // The conversation keeps its files even when the model cannot be reached: they were sent (30 §2).
        attachments.bind({ kind: AttachmentOwnerKind.AssistantMessage, id }, attachmentIds);
        const sent = attachmentIds.map((attachmentId) => attachments.get(attachmentId));
        record(c, [
          {
            kind: TranscriptEntryKind.UserMessage,
            data: sent.length === 0 ? { text } : { text, attachments: sent.map((a) => ({ id: a.id, name: a.name })) },
          },
        ]);
        state.page = page;
        const queued = repo.pendingMessages(id);
        const section = attachments.promptSection(
          sent,
          `${MCP_ASSISTANT_TOOL_PREFIX}${AssistantToolName.ReadAttachment}`,
        );
        await prompt(
          c,
          sessionId,
          systemText,
          [...queued.map((m) => m.text), text, ...(section === '' ? [] : [section])].join('\n\n'),
        );
        repo.acknowledgeMessages(queued.map((m) => m.id));
      });
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
      const c = get(id);
      const state = liveOf(id);
      if (state.busy && c.opencodeSessionId !== null) {
        state.aborting = true;
        await opencode.abort({ sessionId: c.opencodeSessionId, directory: filesDir(id) });
      }
      return toDto(get(id));
    },

    async replyPermission(
      id: string,
      permissionId: string,
      reply: PermissionDecision,
    ): Promise<AssistantConversationDTO> {
      get(id);
      const state = liveOf(id);
      if (!state.permissions.has(permissionId)) {
        throw new AppError(ErrorCode.NotFound, `No open permission request ${permissionId}`, { permissionId });
      }
      await opencode.replyPermission({ permissionId, directory: filesDir(id), reply });
      state.permissions.delete(permissionId);
      return publish(id);
    },

    transcript(id: string, afterSeq: number): TranscriptPage {
      // A conversation never ends: readers keep following it.
      return transcripts.read(get(id), afterSeq, false);
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
  };
}
export type AssistantService = ReturnType<typeof createAssistantService>;
