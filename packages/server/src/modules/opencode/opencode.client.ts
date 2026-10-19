import { AppError, ErrorCode, type ModelInfo, type PermissionDecision, type PermissionRule } from '@aw/shared';
import type { Logger } from '../../core/logger.ts';
import { type OpencodeEvent, OpencodeEventType, parseGlobalEvent } from './opencode.events.ts';
import type { OpencodeRuntime } from './opencode.runtime.ts';

/** Error responses are thrown (and translated by `request`) instead of returned. */
const THROW = { throwOnError: true } as const;

export type ModelRef = { providerId: string; modelId: string };

export type CreateSessionInput = { directory: string; title: string; agent: string; permission: PermissionRule[] };
export type PromptInput = {
  sessionId: string;
  directory: string;
  agent: string;
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
  abort(input: { sessionId: string; directory: string }): Promise<void>;
  replyPermission(input: { permissionId: string; directory: string; reply: PermissionDecision }): Promise<void>;
  /** Models of the providers the user has connected, and the configured default `provider/model`. */
  listModels(): Promise<{ available: ModelInfo[]; defaultModel?: string }>;
  subscribe(listener: (event: OpencodeEvent) => void): () => void;
};

/** `provider/model` → parts; the model id itself may contain `/`. */
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
  const emit = (event: OpencodeEvent) => {
    for (const listener of listeners) listener(event);
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
      });
    }
  }

  return {
    isConnected: runtime.isReady,
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
    async abort({ sessionId, directory }) {
      await request('session.abort', () => runtime.sdk().session.abort({ sessionID: sessionId, directory }, THROW));
    },
    async replyPermission({ permissionId, directory, reply }) {
      await request('permission.reply', () =>
        runtime.sdk().permission.reply({ requestID: permissionId, directory, reply }, THROW),
      );
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
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
