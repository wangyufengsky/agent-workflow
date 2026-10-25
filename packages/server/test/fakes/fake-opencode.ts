import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  AppError,
  ErrorCode,
  ExternalMcpStatus,
  MCP_ASSISTANT_SERVER_NAME,
  MCP_ASSISTANT_TOOL_PREFIX,
  MCP_SERVER_NAME,
  MCP_SESSION_ARG,
  MCP_TOOL_PREFIX,
  type PermissionDecision,
} from '@aw/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  type CreateSessionInput,
  OpencodeEventType as E,
  type McpServerState,
  type OpencodeClient,
  type OpencodeError,
  type OpencodeEvent,
  type OpencodeModel,
  type PromptInput,
  ToolCallStatus,
} from '../../src/modules/opencode/index.ts';

/** Which of our MCP endpoints a tool call goes to: the execution MCP or the assistant MCP (D25). */
export type FakeMcpServer = 'exec' | 'assistant';
export type McpEndpoint = { url: string; token: string };

/** One thing the fake model does during its turn. */
export type FakeStep =
  | { type: 'edit'; file: string; content: string }
  | { type: 'text'; text: string }
  /** The model's reasoning, streamed like text (25 §2.1). */
  | { type: 'think'; text: string }
  /** A native tool call that only reads (`read`, `grep`, a bash command …): reported, nothing happens. */
  | { type: 'tool'; tool: string; input: Record<string, unknown>; output: string }
  | { type: 'callTool'; server: FakeMcpServer; name: string; args: Record<string, unknown> }
  | { type: 'permission'; permission: string; patterns: string[] }
  | { type: 'hang' }
  /** The model service fails: opencode reports a retry per message, then waits until `recoverModel()`. */
  | { type: 'retry'; messages: string[] }
  /** The tokens the turn reports as used when it ends, instead of 100 input and 20 output. */
  | { type: 'usage'; input: number; output: number }
  /** `idle: false`: opencode reports the error without a following idle event. */
  | { type: 'error'; name: string; message: string; idle: boolean };

/** Script builder (07 §4): `script().edit('a.ts', '…').callTool('submit_result', {…})`. The turn ends idle. */
export function script() {
  const steps: FakeStep[] = [];
  const add = (step: FakeStep) => {
    steps.push(step);
    return builder;
  };
  const builder = {
    steps,
    /** Writes the file in the session directory and reports a `write` tool call. */
    edit: (file: string, content: string) => add({ type: 'edit', file, content }),
    /** Reports a native read-only tool call (the knowledge researcher's `read`, `grep` …), 18 §2.1. */
    tool: (tool: string, input: Record<string, unknown>, output = '') => add({ type: 'tool', tool, input, output }),
    /** Streams assistant text in small deltas. */
    text: (text: string) => add({ type: 'text', text }),
    /** Streams reasoning in small deltas. */
    think: (text: string) => add({ type: 'think', text }),
    /** Calls one of our MCP tools over HTTP, with the session id injected as the bridge plugin would. */
    callTool: (name: string, args: Record<string, unknown> = {}) =>
      add({ type: 'callTool', server: 'exec', name, args }),
    /** Calls an assistant MCP tool (15 §3), likewise with the session id injected. */
    callAppTool: (name: string, args: Record<string, unknown> = {}) =>
      add({ type: 'callTool', server: 'assistant', name, args }),
    /** `ask_user` (M3-08) through MCP. */
    ask: (args: { question: string; blocking: boolean; options?: string[]; default_assumption?: string }) =>
      add({ type: 'callTool', server: 'exec', name: 'ask_user', args }),
    /** Asks for a permission and waits until the backend replies. */
    requestPermission: (permission: string, patterns: string[]) => add({ type: 'permission', permission, patterns }),
    /** The tokens the turn reports when it ends (quality and usage, 19). */
    usage: (input: number, output: number) => add({ type: 'usage', input, output }),
    /** Keeps working (never idle) until the session is aborted. */
    hang: () => add({ type: 'hang' }),
    /**
     * The model service cannot be reached: opencode retries the request (one `retry` status per message, `busy` before
     * each request, as 1.19.0 does) and goes on once the test calls `recoverModel()`.
     */
    retry: (...messages: string[]) => add({ type: 'retry', messages }),
    /** Fails the turn with a session error. */
    error: (name: string, message: string, { idle = true }: { idle?: boolean } = {}) =>
      add({ type: 'error', name, message, idle }),
  };
  return builder;
}
export type FakeScript = ReturnType<typeof script>;

export type FakeSession = CreateSessionInput & { id: string };

/**
 * Which session a queued script is for: every given field must be contained in the session's (substring match).
 * Directories are compared with `/` separators, so `/<project>/<taskKey>` also matches Windows paths.
 */
export type ScriptMatch = { title?: string; agent?: string; directory?: string };

const slashed = (path: string) => path.replaceAll('\\', '/');

const matches = (session: FakeSession, match: ScriptMatch | undefined) =>
  match === undefined ||
  ((match.title === undefined || session.title.includes(match.title)) &&
    (match.agent === undefined || session.agent.includes(match.agent)) &&
    (match.directory === undefined || slashed(session.directory).includes(slashed(match.directory))));
export type ToolCallRecord = { sessionId: string; name: string; isError: boolean; result: unknown };

const DELTA_CHARS = 8;

/**
 * Stands in for opencode in integration and browser E2E tests (07 §4): implements OpencodeClient and plays one
 * script per prompt (first queued, first used; no script = the model ends its turn without doing anything).
 */
export function createFakeOpencode() {
  const listeners = new Set<(event: OpencodeEvent) => void>();
  const queue: Array<{ script: Pick<FakeScript, 'steps'>; match: ScriptMatch | undefined }> = [];
  /** Resolvers of `retry` steps, per session, released by recoverModel() or abort(). */
  const waitingForModel = new Map<string, Array<() => void>>();
  /** Resolvers of `hang` steps, per session, released by abort(). */
  const hanging = new Map<string, Array<() => void>>();
  const pendingPermissions = new Map<string, { sessionId: string; resolve: (reply: PermissionDecision) => void }>();
  /** Bumped by abort(): a turn stops when its session's generation changed (later prompts play normally). */
  const generation = new Map<string, number>();
  let connected = true;
  let holding = false;
  const heldSessions = new Set<() => void>();
  /** Set by failNextPrompt(): the next prompt request fails like an opencode HTTP error. */
  let failPrompt = false;
  let closed = false;
  /** Turns being played and MCP calls in flight, so tests can wait for them and close() can let them finish. */
  const turns = new Set<Promise<void>>();
  const toolRequests = new Set<Promise<unknown>>();
  let endpoints: Record<FakeMcpServer, McpEndpoint> | undefined;
  const mcpClients = new Map<FakeMcpServer, Promise<Client>>();
  let counter = 0;

  const sessions: FakeSession[] = [];
  const prompts: PromptInput[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const permissionReplies: Array<{ permissionId: string; reply: PermissionDecision }> = [];
  const aborts: string[] = [];
  const models: OpencodeModel[] = [
    { providerId: 'opencode', modelId: 'fake-model', name: 'Fake Model', contextLimit: 128_000 },
    { providerId: 'opencode', modelId: 'fake-model-2', name: 'Fake Model 2', contextLimit: 128_000 },
  ];
  const projectModels = new Map<string, OpencodeModel[]>();

  // The app's two servers are connected, as in opencode.
  const mcpServers: Record<string, McpServerState> = {
    [MCP_SERVER_NAME]: { status: ExternalMcpStatus.Connected },
    [MCP_ASSISTANT_SERVER_NAME]: { status: ExternalMcpStatus.Connected },
  };

  const nextId = (prefix: string) => `${prefix}_${++counter}`;
  const emit = (event: OpencodeEvent) => {
    if (closed) return;
    for (const listener of listeners) listener(event);
  };

  function client(server: FakeMcpServer): Promise<Client> {
    if (endpoints === undefined) throw new Error('FakeOpencode.connectMcp() was not called');
    const { url, token } = endpoints[server];
    let connected = mcpClients.get(server);
    if (connected === undefined) {
      connected = (async () => {
        const c = new Client({ name: 'fake-opencode', version: '0.0.0' });
        const transport = new StreamableHTTPClientTransport(new URL(url), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        });
        // The SDK's own transport type does not satisfy its Transport interface under exactOptionalPropertyTypes.
        await c.connect(transport as Transport);
        return c;
      })();
      mcpClients.set(server, connected);
    }
    return connected;
  }

  const completions = new WeakMap<PromptInput, Promise<OpencodeError | undefined>>();

  async function play(
    session: FakeSession,
    steps: readonly FakeStep[],
    parentMessageId?: string,
  ): Promise<OpencodeError | undefined> {
    const sessionId = session.id;
    const turnGeneration = generation.get(sessionId) ?? 0;
    const messageId = nextId('fake_msg');
    if (parentMessageId !== undefined) emit({ type: E.Message, sessionId, messageId: parentMessageId, role: 'user' });
    emit({
      type: E.Message,
      sessionId,
      messageId,
      role: 'assistant',
      ...(parentMessageId === undefined ? {} : { parentMessageId }),
    });
    let used = { input: 100, output: 20 };
    for (const step of steps) {
      if ((generation.get(sessionId) ?? 0) !== turnGeneration || closed)
        return { name: 'MessageAbortedError', data: { message: 'Aborted' } };
      const partId = nextId('fake_prt');
      const ids = { sessionId, messageId, partId };
      switch (step.type) {
        case 'edit': {
          const path = join(session.directory, step.file);
          const input = { filePath: path, content: step.content };
          emit({ type: E.Tool, ...ids, callId: partId, tool: 'write', status: ToolCallStatus.Running, input });
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, step.content);
          emit({
            type: E.Tool,
            ...ids,
            callId: partId,
            tool: 'write',
            status: ToolCallStatus.Completed,
            input,
            output: 'Wrote file successfully.',
          });
          break;
        }
        case 'tool': {
          const { tool, input, output } = step;
          emit({ type: E.Tool, ...ids, callId: partId, tool, status: ToolCallStatus.Running, input });
          emit({ type: E.Tool, ...ids, callId: partId, tool, status: ToolCallStatus.Completed, input, output });
          break;
        }
        case 'text':
        case 'think': {
          const kind = step.type === 'text' ? 'text' : 'reasoning';
          emit({ type: E.Text, ...ids, kind, text: '', done: false });
          for (let i = 0; i < step.text.length; i += DELTA_CHARS) {
            emit({ type: E.TextDelta, ...ids, delta: step.text.slice(i, i + DELTA_CHARS) });
          }
          emit({ type: E.Text, ...ids, kind, text: step.text, done: true });
          break;
        }
        case 'callTool': {
          const { server } = step;
          const tool = `${server === 'exec' ? MCP_TOOL_PREFIX : MCP_ASSISTANT_TOOL_PREFIX}${step.name}`;
          const input = { ...step.args, [MCP_SESSION_ARG]: sessionId };
          emit({ type: E.Tool, ...ids, callId: partId, tool, status: ToolCallStatus.Running, input });
          const request = client(server).then((c) => c.callTool({ name: step.name, arguments: input }));
          toolRequests.add(request);
          const result = await request.finally(() => toolRequests.delete(request));
          if (closed) return;
          const content = result.content as Array<{ type: string; text: string }>;
          const text = content.map((c) => c.text).join('');
          const isError = result.isError === true;
          toolCalls.push({ sessionId, name: step.name, isError, result: JSON.parse(text) });
          emit({
            type: E.Tool,
            ...ids,
            callId: partId,
            tool,
            status: isError ? ToolCallStatus.Error : ToolCallStatus.Completed,
            input,
            ...(isError ? { error: text } : { output: text }),
          });
          break;
        }
        case 'permission': {
          const permissionId = nextId('fake_per');
          const replied = new Promise<PermissionDecision>((resolve) =>
            pendingPermissions.set(permissionId, { sessionId, resolve }),
          );
          const { permission, patterns } = step;
          emit({
            type: E.PermissionAsked,
            sessionId,
            directory: session.directory,
            permissionId,
            messageId,
            permission,
            patterns,
          });
          await replied;
          break;
        }
        case 'usage':
          used = step;
          break;
        case 'hang':
          await new Promise<void>((resolve) => hanging.set(sessionId, [...(hanging.get(sessionId) ?? []), resolve]));
          break;
        case 'retry':
          for (const message of step.messages) {
            emit({ type: E.Busy, sessionId });
            emit({ type: E.Retry, sessionId, message });
          }
          await new Promise<void>((resolve) =>
            waitingForModel.set(sessionId, [...(waitingForModel.get(sessionId) ?? []), resolve]),
          );
          if ((generation.get(sessionId) ?? 0) === turnGeneration) emit({ type: E.Busy, sessionId });
          break;
        case 'error':
          emit({ type: E.Error, sessionId, error: { name: step.name, data: { message: step.message } } });
          if (step.idle) emit({ type: E.Idle, sessionId });
          return { name: step.name, data: { message: step.message } };
      }
    }
    emit({
      type: E.StepFinished,
      sessionId,
      messageId,
      partId: nextId('step'),
      tokens: { input: used.input, output: used.output },
      cost: 0,
    });
    emit({ type: E.Idle, sessionId });
  }

  function sessionOf(id: string): FakeSession {
    const session = sessions.find((s) => s.id === id);
    if (session === undefined) throw new Error(`FakeOpencode has no session ${id}`);
    return session;
  }

  const fake: OpencodeClient & {
    sessions: FakeSession[];
    prompts: PromptInput[];
    toolCalls: ToolCallRecord[];
    permissionReplies: typeof permissionReplies;
    /** Session ids the backend aborted, in order. */
    aborts: string[];
    /** The global configuration's models. */
    models: OpencodeModel[];
    /** What a directory's own opencode configuration adds, by directory. */
    projectModels: Map<string, OpencodeModel[]>;
    /** What `mcpStatus` reports, by server name; a test adds the user's own servers. */
    mcpServers: Record<string, McpServerState>;
    /** Where `callTool` reaches the backend's execution MCP and `callAppTool` its assistant MCP. */
    connectMcp(endpoints: Record<FakeMcpServer, McpEndpoint>): void;
    /**
     * Queues a script for a later prompt: the first queued script whose `match` fits the prompted session plays
     * (no match = any session).
     */
    enqueue(s: Pick<FakeScript, 'steps'>, match?: ScriptMatch): void;
    /** Resolves once every turn started so far has played out (a turn waiting for a permission never does). */
    settled(): Promise<void>;
    /** The runtime disappears: `runtime_lost`, and requests fail until `reconnect()`. */
    crash(): void;
    /** `createSession` requests wait until the runtime goes away (`shutdown`), then fail as opencode's would. */
    holdSessions(): void;
    /** The next `prompt` request fails with OPENCODE_REQUEST_FAILED while the runtime stays connected. */
    failNextPrompt(): void;
    /** The model service is back: turns waiting in a `retry` step send their request again and go on. */
    recoverModel(): void;
    /** 重放真实捕获的事件，验证迟到报告和重复投递。 */
    replay(events: readonly OpencodeEvent[]): void;
    reconnect(): void;
    close(): Promise<void>;
  } = {
    sessions,
    prompts,
    toolCalls,
    permissionReplies,
    aborts,
    models,
    projectModels,
    connectMcp(next) {
      endpoints = next;
      // A restarted backend listens elsewhere: reconnect on the next call.
      mcpClients.clear();
      closed = false;
    },
    enqueue(s, match) {
      queue.push({ script: s, match });
    },
    async settled() {
      // 请求完成回调还可能继续投递 outbox；事件循环推进到这些回调完成后再检查新增轮次。
      do {
        await Promise.all(turns);
        await new Promise<void>((resolve) => setImmediate(resolve));
      } while (turns.size > 0);
    },
    recoverModel() {
      for (const release of [...waitingForModel.values()].flat()) release();
      waitingForModel.clear();
    },
    failNextPrompt() {
      failPrompt = true;
    },
    replay(events) {
      for (const event of events) emit(event);
    },
    crash() {
      connected = false;
      emit({ type: E.RuntimeLost });
    },
    holdSessions() {
      holding = true;
    },
    /**
     * The backend stops opencode on its way out (app quit): `runtime_lost`, then requests still in flight fail. The
     * backend handles those failures before it closes, as it does with the real process tree being ended.
     */
    async shutdown() {
      connected = false;
      emit({ type: E.RuntimeLost });
      holding = false;
      const held = [...heldSessions];
      heldSessions.clear();
      for (const release of held) release();
      await new Promise((resolve) => setImmediate(resolve));
    },
    reconnect() {
      connected = true;
    },
    /** Stops emitting events and lets MCP calls in flight finish before the backend goes away. */
    async close() {
      closed = true;
      // A backend started later (simulated restart) subscribes anew.
      listeners.clear();
      await Promise.allSettled(toolRequests);
      for (const c of mcpClients.values()) await (await c).close();
      mcpClients.clear();
    },
    isConnected: () => connected,
    async createSession(input) {
      if (holding) await new Promise<void>((resolve) => heldSessions.add(resolve));
      if (!connected) throw new Error('FakeOpencode is not connected');
      const session = { ...input, id: nextId('fake_ses') };
      sessions.push(session);
      return session.id;
    },
    async prompt(input) {
      if (!connected) throw new Error('FakeOpencode is not connected');
      if (failPrompt) {
        failPrompt = false;
        throw new AppError(ErrorCode.OpencodeRequestFailed, 'opencode session.promptAsync failed', {
          responseReceived: true,
        });
      }
      const session = sessionOf(input.sessionId);
      prompts.push(input);
      const index = queue.findIndex((q) => matches(session, q.match));
      const steps = index === -1 ? [] : (queue.splice(index, 1)[0]?.script.steps ?? []);
      // Like prompt_async: return at once, the turn plays out as events.
      const completion = new Promise<void>((resolve) => setImmediate(resolve)).then(() =>
        play(session, steps, input.messageId),
      );
      completions.set(input, completion);
      const turn = completion.then(() => undefined);
      turns.add(turn);
      void turn.finally(() => turns.delete(turn));
    },
    promptAssistant(input) {
      const accepted = Promise.withResolvers<void>();
      const started = Promise.withResolvers<void>();
      let running = false;
      const lost = Promise.withResolvers<never>();
      const unsubscribe = fake.subscribe((event) => {
        if (event.type === E.RuntimeLost) lost.reject(new Error('opencode runtime lost'));
        if (event.type === E.Message && event.sessionId === input.sessionId && event.messageId === input.messageId)
          accepted.resolve();
        if (
          event.type === E.Message &&
          event.sessionId === input.sessionId &&
          event.parentMessageId === input.messageId
        ) {
          running = true;
          started.resolve();
        }
      });
      const completed = Promise.race([fake.prompt(input).then(() => completions.get(input)), lost.promise])
        .then(
          (error) => {
            accepted.resolve();
            return { error };
          },
          (error: unknown) => {
            accepted.reject(error);
            throw error;
          },
        )
        .finally(unsubscribe);
      return { accepted: accepted.promise, started: started.promise, isRunning: async () => running, completed };
    },
    async deleteSession({ sessionId }) {
      const index = sessions.findIndex((s) => s.id === sessionId);
      if (index >= 0) sessions.splice(index, 1);
    },
    async abort({ sessionId }) {
      aborts.push(sessionId);
      // An HTTP request to opencode: events already on their way arrive first, like the usage of the step that just
      // called a tool (opencode 1.19.0 sends step-finish right after the tool result, test/fixtures).
      await Promise.resolve();
      generation.set(sessionId, (generation.get(sessionId) ?? 0) + 1);
      for (const release of [...(hanging.get(sessionId) ?? []), ...(waitingForModel.get(sessionId) ?? [])]) release();
      hanging.delete(sessionId);
      waitingForModel.delete(sessionId);
      for (const [id, pending] of pendingPermissions) {
        if (pending.sessionId !== sessionId) continue;
        pendingPermissions.delete(id);
        pending.resolve('reject');
      }
      emit({ type: E.Error, sessionId, error: { name: 'MessageAbortedError', data: { message: 'Aborted' } } });
      emit({ type: E.Idle, sessionId });
    },
    async replyPermission({ permissionId, reply }) {
      const resolve = pendingPermissions.get(permissionId);
      if (resolve === undefined) throw new Error(`FakeOpencode has no pending permission ${permissionId}`);
      permissionReplies.push({ permissionId, reply });
      pendingPermissions.delete(permissionId);
      emit({ type: E.PermissionReplied, sessionId: resolve.sessionId, permissionId, reply });
      resolve.resolve(reply);
    },
    async listModels(directory) {
      return { available: [...models, ...(directory === undefined ? [] : (projectModels.get(directory) ?? []))] };
    },
    mcpServers,
    async mcpStatus() {
      if (!connected) throw new AppError(ErrorCode.OpencodeNotReady, 'FakeOpencode is not connected');
      return mcpServers;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return fake;
}
export type FakeOpencode = ReturnType<typeof createFakeOpencode>;
