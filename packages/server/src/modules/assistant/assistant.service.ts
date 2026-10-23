import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  AppError,
  ASSISTANT_CONVERSATIONS_DIR,
  ASSISTANT_DIR,
  ASSISTANT_FILES_DIR,
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
  /** The user asked to stop: the abort's own error is not the conversation's. */
  aborting: boolean;
  view: SessionView;
  permissions: Map<string, AssistantPermissionRequestDTO>;
  /** Messages for the model (confirmation results) waiting until it can take them: its turn ended, or it is back. */
  outbox: string[];
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
 * Assistant conversations (15): each is one opencode session of `aw-assistant` running in `<data dir>/assistant/`.
 * Messages go out with the per-turn context; the session's events become the conversation's message stream.
 */
export function createAssistantService(deps: AssistantServiceDeps) {
  const { db, unit, events, clock, log, opencode, settings, attachments, context } = deps;
  const repo = createAssistantRepo(db);
  const directory = join(deps.dataDir, ASSISTANT_DIR);
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
        aborting: false,
        view: createSessionView(),
        permissions: new Map(),
        outbox: [],
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
      busy: state.busy,
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

  function system(c: Conversation, page: AssistantPageRef | undefined): string {
    return context.render({
      time: localTime(clock.now(), deps.timeZone),
      uiMode: settings.get('ui.mode'),
      page,
      filesDir: `${ASSISTANT_FILES_DIR}/${c.id}/ (absolute: ${filesDir(c.id)})`,
    });
  }

  async function sessionOf(c: Conversation): Promise<string> {
    if (c.opencodeSessionId !== null) {
      sessions.set(c.opencodeSessionId, c.id);
      return c.opencodeSessionId;
    }
    mkdirSync(filesDir(c.id), { recursive: true });
    const sessionId = await opencode.createSession({
      directory,
      title: `Assistant · ${c.title}`,
      agent: OPENCODE_ASSISTANT_AGENT,
      permission: assistantPermissionRules(),
    });
    repo.updateConversation(c.id, { opencodeSessionId: sessionId });
    sessions.set(sessionId, c.id);
    log.info({ conversationId: c.id, sessionId }, 'assistant session created');
    return sessionId;
  }

  /** Starts a turn; the conversation is busy until the session goes idle. */
  async function prompt(c: Conversation, sessionId: string, systemText: string, text: string): Promise<void> {
    const state = liveOf(c.id);
    state.busy = true;
    publish(c.id);
    const model = settings.get('ai.defaultModel');
    try {
      await opencode.prompt({
        sessionId,
        directory,
        agent: OPENCODE_ASSISTANT_AGENT,
        ...(model === null ? {} : { model: parseModelRef(model) }),
        system: systemText,
        text,
      });
    } catch (err) {
      state.busy = false;
      publish(c.id);
      throw err;
    }
  }

  /** Sends what waits in the outbox, once the session can take it. */
  async function flush(id: string): Promise<void> {
    const state = liveOf(id);
    if (state.busy || state.outbox.length === 0 || !opencode.isConnected()) return;
    const c = get(id);
    const text = state.outbox.splice(0).join('\n\n');
    try {
      await prompt(c, await sessionOf(c), system(c, state.page), text);
    } catch (err) {
      state.outbox.unshift(text);
      throw err;
    }
  }

  function onToolEvent(
    c: Conversation,
    state: Live,
    event: Extract<OpencodeEvent, { type: typeof OpencodeEventType.Tool }>,
  ): void {
    if (event.status !== ToolCallStatus.Completed || !FILE_WRITING_TOOLS.has(event.tool)) return;
    const { filePath } = event.input;
    if (typeof filePath !== 'string') return;
    const path = relative(filesDir(c.id), resolve(directory, filePath));
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
        flush(id).catch((err: unknown) => log.error({ err, conversationId: id }, 'assistant message not sent'));
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
      repo.insertConversation({ id, title: title ?? '', opencodeSessionId: null, createdAt: now, updatedAt: now });
      log.info({ conversationId: id }, 'assistant conversation created');
      return publish(id);
    },

    /** The session stops first; then the rows (confirmations cascade), the message stream and the files go. */
    async delete(id: string): Promise<void> {
      const c = get(id);
      const state = liveOf(id);
      if (state.busy && c.opencodeSessionId !== null) {
        await opencode.abort({ sessionId: c.opencodeSessionId, directory });
      }
      if (c.opencodeSessionId !== null) sessions.delete(c.opencodeSessionId);
      live.delete(id);
      // Together: a conversation that survives a failed delete keeps its attachments (30 §4).
      unit.transact(() => {
        attachments.release(AttachmentOwnerKind.AssistantMessage, [id]);
        repo.deleteConversation(id);
      });
      transcripts.forget(c);
      rmSync(join(directory, ASSISTANT_CONVERSATIONS_DIR, `${id}.jsonl`), { force: true });
      rmSync(filesDir(id), { recursive: true, force: true });
      log.info({ conversationId: id }, 'assistant conversation deleted');
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
      if (state.busy) throw new AppError(ErrorCode.AssistantBusy, `Conversation ${id} is busy`, { id });
      if (!opencode.isConnected()) throw new AppError(ErrorCode.OpencodeNotReady, 'opencode is not ready');
      // Rendered first: a page about a deleted entity fails before anything is recorded.
      const systemText = system(c, page);
      const titled = c.title === '' ? { ...c, title: titleOf(text) } : c;
      repo.updateConversation(id, { title: titled.title, updatedAt: clock.now() });
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
      const queued = state.outbox.splice(0);
      const section = attachments.promptSection(
        sent,
        `${MCP_ASSISTANT_TOOL_PREFIX}${AssistantToolName.ReadAttachment}`,
      );
      try {
        await prompt(
          get(id),
          sessionId,
          systemText,
          [...queued, text, ...(section === '' ? [] : [section])].join('\n\n'),
        );
      } catch (err) {
        // The model has not seen them: they go with the next message.
        state.outbox.unshift(...queued);
        throw err;
      }
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
      liveOf(id).outbox.push(text);
      await flush(id);
    },

    async abort(id: string): Promise<AssistantConversationDTO> {
      const c = get(id);
      const state = liveOf(id);
      if (state.busy && c.opencodeSessionId !== null) {
        state.aborting = true;
        await opencode.abort({ sessionId: c.opencodeSessionId, directory });
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
      await opencode.replyPermission({ permissionId, directory, reply });
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
