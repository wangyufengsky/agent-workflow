import {
  AppError,
  ErrorCode,
  type ExternalMcpStatus,
  type ModelInfo,
  type PermissionDecision,
  type PermissionRule,
} from '@aw/shared';
import { z } from 'zod';
import type { Logger } from '../../core/logger.ts';
import { type OpencodeError, type OpencodeEvent, OpencodeEventType, parseGlobalEvent } from './opencode.events.ts';
import type { OpencodeRuntime } from './opencode.runtime.ts';

/** Error responses are thrown (and translated by `request`) instead of returned. */
const THROW = { throwOnError: true } as const;

const responseCauseSchema = z.object({ status: z.number() });
const permissionNotFoundCauseSchema = z.object({
  status: z.literal(404),
  body: z.object({ _tag: z.literal('PermissionNotFoundError'), requestID: z.string(), message: z.string() }),
});

const sessionNotFoundCauseSchema = z.object({
  status: z.literal(404),
  body: z.object({ name: z.literal('NotFoundError'), data: z.object({ message: z.string() }) }),
});

export type AssistantPrompt = {
  accepted: Promise<void>;
  /** 本轮 assistant.parentID marker；原生 Runner 此时已经注册。 */
  started: Promise<void>;
  /** SSE 丢失时查原生状态；独占会话的 busy/retry 才能证明已启动。 */
  isRunning(): Promise<boolean>;
  completed: Promise<{ error: OpencodeError | undefined }>;
};

export type ModelRef = { providerId: string; modelId: string };

export type CreateSessionInput = { directory: string; title: string; agent: string; permission: PermissionRule[] };
export type PromptInput = {
  sessionId: string;
  directory: string;
  agent: string;
  /** 助手请求的显式 user message id；任务尝试不设置。 */
  messageId?: string;
  model?: ModelRef;
  /** Appended to the agent prompt for this message (role prompt, 12 §2). */
  system?: string;
  text: string;
};

/**
 * The only way other modules talk to opencode (06 §2.3); `FakeOpencode` implements it for tests.
 * Only what the app uses is wrapped (M2-04).
 */
export type OpencodeClient = {
  /** Whether requests can be served now (the hosted runtime is ready). */
  isConnected(): boolean;
  /** Returns the new session id. */
  createSession(input: CreateSessionInput): Promise<string>;
  /** Sends a message and returns at once (`prompt_async`); progress arrives as events. */
  prompt(input: PromptInput): Promise<void>;
  /** 助手按请求关联完成；接受与结束分开，消息不必等模型整轮结束才清空草稿。 */
  promptAssistant(input: PromptInput & { messageId: string }): AssistantPrompt;
  abort(input: { sessionId: string; directory: string }): Promise<void>;
  /** Already missing sessions count as deleted, so interrupted cleanup can be retried. */
  deleteSession(input: { sessionId: string; directory: string }): Promise<void>;
  replyPermission(input: { permissionId: string; directory: string; reply: PermissionDecision }): Promise<void>;
  /** Models of the providers the user has connected, and the configured default `provider/model`. */
  listModels(): Promise<{ available: ModelInfo[]; defaultModel?: string }>;
  /** Every MCP server of the configuration `directory` sees, by name: the app's own and the user's (28 §4). */
  mcpStatus(directory: string): Promise<Record<string, McpServerState>>;
  subscribe(listener: (event: OpencodeEvent) => void): () => void;
  /**
   * The backend shuts down (app quit): opencode goes with it. Its sessions are lost like in a crash (`runtime_lost`,
   * attempts interrupted, not failed) before the process tree is ended (09 §4, D73).
   */
  shutdown(): Promise<void>;
};

/** `provider/model` → parts; the model id itself may contain `/`. */
/** opencode's report of one MCP server; `error` only when it failed or needs a client registration. */
export type McpServerState = { status: ExternalMcpStatus; error?: string };

export function parseModelRef(value: string): ModelRef {
  const slash = value.indexOf('/');
  if (slash <= 0 || slash === value.length - 1) {
    throw new AppError(ErrorCode.ValidationFailed, `Model must be provider/model, got ${value}`);
  }
  return { providerId: value.slice(0, slash), modelId: value.slice(slash + 1) };
}

/** OpencodeClient over the SDK of the hosted runtime. */
export function createRuntimeClient(runtime: OpencodeRuntime, log: Logger): OpencodeClient {
  const listeners = new Set<(event: OpencodeEvent) => void>();
  /**
   * Each subscriber handles each event on its own (D70): a defect in handling one event is logged with its stack and
   * the event, and the other subscribers and the following events go on. Thrown into the stream loop it would end
   * the subscription and leave every session without events.
   */
  const emit = (event: OpencodeEvent) => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (err) {
        const sessionId = 'sessionId' in event ? event.sessionId : undefined;
        log.error({ err, event: event.type, sessionId }, 'opencode event handler failed');
      }
    }
  };

  runtime.onEvent((raw) => {
    let event: OpencodeEvent | undefined;
    try {
      event = parseGlobalEvent(raw);
    } catch (err) {
      // An event of a type we consume no longer matches opencode 1.19.0; skip it but make the mismatch visible.
      log.error({ err }, 'unexpected opencode event shape');
      return;
    }
    if (event !== undefined) emit(event);
  });
  runtime.onLost(() => emit({ type: OpencodeEventType.RuntimeLost }));

  /** SDK failures (thrown error bodies or network errors) become OPENCODE_REQUEST_FAILED. */
  async function request<T>(operation: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(ErrorCode.OpencodeRequestFailed, `opencode ${operation} failed`, {
        operation,
        error: err instanceof Error ? err.message : err,
        responseReceived: err instanceof Error && responseCauseSchema.safeParse(err.cause).success,
      });
    }
  }

  return {
    isConnected: runtime.isReady,
    shutdown: runtime.shutdown,
    async createSession({ directory, title, agent, permission }) {
      const { data } = await request('session.create', () =>
        runtime.sdk().session.create({ directory, title, agent, permission }, THROW),
      );
      return data.id;
    },
    async prompt({ sessionId, directory, agent, model, system, text }) {
      await request('session.promptAsync', () =>
        runtime.sdk().session.promptAsync(
          {
            sessionID: sessionId,
            directory,
            agent,
            ...(model === undefined ? {} : { model: { providerID: model.providerId, modelID: model.modelId } }),
            ...(system === undefined ? {} : { system }),
            parts: [{ type: 'text', text }],
          },
          THROW,
        ),
      );
    },
    promptAssistant({ sessionId, directory, agent, model, system, text, messageId }) {
      const accepted = Promise.withResolvers<void>();
      const started = Promise.withResolvers<void>();
      let running = false;
      const abort = new AbortController();
      const observe = (event: OpencodeEvent) => {
        if (event.type === OpencodeEventType.RuntimeLost) abort.abort(new Error('opencode runtime lost'));
        if (event.type === OpencodeEventType.Message && event.sessionId === sessionId && event.messageId === messageId)
          accepted.resolve();
        if (
          event.type === OpencodeEventType.Message &&
          event.sessionId === sessionId &&
          event.parentMessageId === messageId
        ) {
          running = true;
          started.resolve();
        }
      };
      listeners.add(observe);
      const completed = request('session.prompt', () =>
        runtime.sdk().session.prompt(
          {
            sessionID: sessionId,
            messageID: messageId,
            directory,
            agent,
            ...(model === undefined ? {} : { model: { providerID: model.providerId, modelID: model.modelId } }),
            ...(system === undefined ? {} : { system }),
            parts: [{ type: 'text', text }],
          },
          { ...THROW, signal: abort.signal },
        ),
      )
        .then(
          ({ data }) => {
            // SSE 暂时断开时，成功的 HTTP 结果本身也证明已接受，不无限等一个丢失的 marker。
            accepted.resolve();
            return { error: 'error' in data.info ? data.info.error : undefined };
          },
          (error: unknown) => {
            accepted.reject(error);
            throw error;
          },
        )
        .finally(() => listeners.delete(observe));
      return {
        accepted: accepted.promise,
        started: started.promise,
        completed,
        async isRunning() {
          if (running) return true;
          const { data } = await request('session.status', () => runtime.sdk().session.status({ directory }, THROW));
          return data[sessionId]?.type === 'busy' || data[sessionId]?.type === 'retry';
        },
      };
    },
    async abort({ sessionId, directory }) {
      await request('session.abort', () => runtime.sdk().session.abort({ sessionID: sessionId, directory }, THROW));
    },
    async deleteSession({ sessionId, directory }) {
      await request('session.delete', async () => {
        try {
          await runtime.sdk().session.delete({ sessionID: sessionId, directory }, THROW);
        } catch (err) {
          // 原生删除成功后，本地清理可能中断；只将 SDK 明确返回的会话不存在视为已完成。
          if (err instanceof Error && sessionNotFoundCauseSchema.safeParse(err.cause).success) return;
          throw err;
        }
      });
    },
    async replyPermission({ permissionId, directory, reply }) {
      await request('permission.reply', async () => {
        try {
          await runtime.sdk().permission.reply({ requestID: permissionId, directory, reply }, THROW);
        } catch (err) {
          const missing = err instanceof Error ? permissionNotFoundCauseSchema.safeParse(err.cause) : undefined;
          if (missing?.success && missing.data.body.requestID === permissionId) {
            throw new AppError(ErrorCode.PermissionRequestExpired, 'Permission request is no longer pending', {
              permissionId,
            });
          }
          throw err;
        }
      });
    },
    async listModels() {
      const sdk = runtime.sdk();
      const [{ data: providers }, { data: config }] = await Promise.all([
        request('config.providers', () => sdk.config.providers({}, THROW)),
        request('config.get', () => sdk.config.get({}, THROW)),
      ]);
      const available = providers.providers.flatMap((p) =>
        Object.values(p.models).map((m) => ({ providerId: p.id, modelId: m.id, name: m.name })),
      );
      return config.model === undefined ? { available } : { available, defaultModel: config.model };
    },
    async mcpStatus(directory) {
      const { data } = await request('mcp.status', () => runtime.sdk().mcp.status({ directory }, THROW));
      return data;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
