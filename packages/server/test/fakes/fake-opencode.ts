import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { MCP_SESSION_ARG, MCP_TOOL_PREFIX, type ModelInfo, type PermissionDecision } from '@aw/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  type CreateSessionInput,
  OpencodeEventType as E,
  type OpencodeClient,
  type OpencodeEvent,
  type PromptInput,
  ToolCallStatus,
} from '../../src/modules/opencode/index.ts';

/** One thing the fake model does during its turn. */
export type FakeStep =
  | { type: 'edit'; file: string; content: string }
  | { type: 'text'; text: string }
  | { type: 'callTool'; name: string; args: Record<string, unknown> }
  | { type: 'permission'; permission: string; patterns: string[] }
  | { type: 'hang' }
  | { type: 'error'; name: string; message: string };

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
    /** Streams assistant text in small deltas. */
    text: (text: string) => add({ type: 'text', text }),
    /** Calls one of our MCP tools over HTTP, with the session id injected as the bridge plugin would. */
    callTool: (name: string, args: Record<string, unknown> = {}) => add({ type: 'callTool', name, args }),
    /** `ask_user` (M3-08) through MCP. */
    ask: (args: { question: string; blocking: boolean; options?: string[]; default_assumption?: string }) =>
      add({ type: 'callTool', name: 'ask_user', args }),
    /** Asks for a permission and waits until the backend replies. */
    requestPermission: (permission: string, patterns: string[]) => add({ type: 'permission', permission, patterns }),
    /** Keeps working (never idle) until the session is aborted. */
    hang: () => add({ type: 'hang' }),
    /** Fails the turn with a session error. */
    error: (name: string, message: string) => add({ type: 'error', name, message }),
  };
  return builder;
}
export type FakeScript = ReturnType<typeof script>;

export type FakeSession = CreateSessionInput & { id: string };

/**
 * Which session a queued script is for: every given field must be contained in the session's (substring match).
 * `directory` is written with `/` on every platform (`/<project>/<taskKey>`); Windows paths are compared that way.
 */
export type ScriptMatch = { title?: string; agent?: string; directory?: string };

const matches = (session: FakeSession, match: ScriptMatch | undefined) =>
  match === undefined ||
  ((match.title === undefined || session.title.includes(match.title)) &&
    (match.agent === undefined || session.agent.includes(match.agent)) &&
    (match.directory === undefined || session.directory.replaceAll('\\', '/').includes(match.directory)));
export type ToolCallRecord = { sessionId: string; name: string; isError: boolean; result: unknown };

const DELTA_CHARS = 8;

/**
 * Stands in for opencode in integration and browser E2E tests (07 §4): implements OpencodeClient and plays one
 * script per prompt (first queued, first used; no script = the model ends its turn without doing anything).
 */
export function createFakeOpencode() {
  const listeners = new Set<(event: OpencodeEvent) => void>();
  const queue: Array<{ script: Pick<FakeScript, 'steps'>; match: ScriptMatch | undefined }> = [];
  /** Resolvers of `hang` steps, per session, released by abort(). */
  const hanging = new Map<string, Array<() => void>>();
  const pendingPermissions = new Map<string, (reply: PermissionDecision) => void>();
  /** Bumped by abort(): a turn stops when its session's generation changed (later prompts play normally). */
  const generation = new Map<string, number>();
  let connected = true;
  let closed = false;
  /** Turns being played and MCP calls in flight, so tests can wait for them and close() can let them finish. */
  const turns = new Set<Promise<void>>();
  const toolRequests = new Set<Promise<unknown>>();
  let mcp: { url: string; token: string } | undefined;
  let mcpClient: Promise<Client> | undefined;
  let counter = 0;

  const sessions: FakeSession[] = [];
  const prompts: PromptInput[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const permissionReplies: Array<{ permissionId: string; reply: PermissionDecision }> = [];
  const aborts: string[] = [];
  const models: ModelInfo[] = [{ providerId: 'opencode', modelId: 'fake-model', name: 'Fake Model' }];

  const nextId = (prefix: string) => `${prefix}_${++counter}`;
  const emit = (event: OpencodeEvent) => {
    if (closed) return;
    for (const listener of listeners) listener(event);
  };

  function client(): Promise<Client> {
    if (mcp === undefined) throw new Error('FakeOpencode.connectMcp() was not called');
    const { url, token } = mcp;
    mcpClient ??= (async () => {
      const c = new Client({ name: 'fake-opencode', version: '0.0.0' });
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      // The SDK's own transport type does not satisfy its Transport interface under exactOptionalPropertyTypes.
      await c.connect(transport as Transport);
      return c;
    })();
    return mcpClient;
  }

  async function play(session: FakeSession, steps: readonly FakeStep[]): Promise<void> {
    const sessionId = session.id;
    const turnGeneration = generation.get(sessionId) ?? 0;
    const messageId = nextId('fake_msg');
    emit({ type: E.Message, sessionId, messageId, role: 'assistant' });
    for (const step of steps) {
      if ((generation.get(sessionId) ?? 0) !== turnGeneration || closed) return;
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
        case 'text': {
          emit({ type: E.Text, ...ids, kind: 'text', text: '', done: false });
          for (let i = 0; i < step.text.length; i += DELTA_CHARS) {
            emit({ type: E.TextDelta, ...ids, delta: step.text.slice(i, i + DELTA_CHARS) });
          }
          emit({ type: E.Text, ...ids, kind: 'text', text: step.text, done: true });
          break;
        }
        case 'callTool': {
          const tool = `${MCP_TOOL_PREFIX}${step.name}`;
          const input = { ...step.args, [MCP_SESSION_ARG]: sessionId };
          emit({ type: E.Tool, ...ids, callId: partId, tool, status: ToolCallStatus.Running, input });
          const request = client().then((c) => c.callTool({ name: step.name, arguments: input }));
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
          const replied = new Promise<PermissionDecision>((resolve) => pendingPermissions.set(permissionId, resolve));
          const { permission, patterns } = step;
          emit({
            type: E.PermissionAsked,
            sessionId,
            directory: session.directory,
            permissionId,
            permission,
            patterns,
          });
          await replied;
          break;
        }
        case 'hang':
          await new Promise<void>((resolve) => hanging.set(sessionId, [...(hanging.get(sessionId) ?? []), resolve]));
          break;
        case 'error':
          emit({ type: E.Error, sessionId, error: { name: step.name, data: { message: step.message } } });
          emit({ type: E.Idle, sessionId });
          return;
      }
    }
    emit({ type: E.StepFinished, sessionId, tokens: { input: 100, output: 20 }, cost: 0 });
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
    models: ModelInfo[];
    /** Where `callTool` reaches the backend's execution MCP. */
    connectMcp(endpoint: { url: string; token: string }): void;
    /**
     * Queues a script for a later prompt: the first queued script whose `match` fits the prompted session plays
     * (no match = any session).
     */
    enqueue(s: Pick<FakeScript, 'steps'>, match?: ScriptMatch): void;
    /** Resolves once every turn started so far has played out (a turn waiting for a permission never does). */
    settled(): Promise<void>;
    /** The runtime disappears: `runtime_lost`, and requests fail until `reconnect()`. */
    crash(): void;
    reconnect(): void;
    close(): Promise<void>;
  } = {
    sessions,
    prompts,
    toolCalls,
    permissionReplies,
    aborts,
    models,
    connectMcp(endpoint) {
      mcp = endpoint;
      // A restarted backend listens elsewhere: reconnect on the next call.
      mcpClient = undefined;
      closed = false;
    },
    enqueue(s, match) {
      queue.push({ script: s, match });
    },
    async settled() {
      await Promise.all(turns);
    },
    crash() {
      connected = false;
      emit({ type: E.RuntimeLost });
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
      if (mcpClient !== undefined) await (await mcpClient).close();
      mcpClient = undefined;
    },
    isConnected: () => connected,
    async createSession(input) {
      if (!connected) throw new Error('FakeOpencode is not connected');
      const session = { ...input, id: nextId('fake_ses') };
      sessions.push(session);
      return session.id;
    },
    async prompt(input) {
      if (!connected) throw new Error('FakeOpencode is not connected');
      const session = sessionOf(input.sessionId);
      prompts.push(input);
      const index = queue.findIndex((q) => matches(session, q.match));
      const steps = index === -1 ? [] : (queue.splice(index, 1)[0]?.script.steps ?? []);
      // Like prompt_async: return at once, the turn plays out as events.
      const turn = new Promise<void>((resolve) => setImmediate(resolve)).then(() => play(session, steps));
      turns.add(turn);
      void turn.finally(() => turns.delete(turn));
    },
    async abort({ sessionId }) {
      aborts.push(sessionId);
      generation.set(sessionId, (generation.get(sessionId) ?? 0) + 1);
      for (const release of hanging.get(sessionId) ?? []) release();
      hanging.delete(sessionId);
      emit({ type: E.Error, sessionId, error: { name: 'MessageAbortedError', data: { message: 'Aborted' } } });
      emit({ type: E.Idle, sessionId });
    },
    async replyPermission({ permissionId, reply }) {
      const resolve = pendingPermissions.get(permissionId);
      if (resolve === undefined) throw new Error(`FakeOpencode has no pending permission ${permissionId}`);
      permissionReplies.push({ permissionId, reply });
      pendingPermissions.delete(permissionId);
      resolve(reply);
    },
    async listModels() {
      return { available: models };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return fake;
}
export type FakeOpencode = ReturnType<typeof createFakeOpencode>;
