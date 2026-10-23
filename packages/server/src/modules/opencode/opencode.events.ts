import { z } from 'zod';

/** Internal events derived from opencode's global stream (12 §8); the only opencode events other modules see. */
export const OpencodeEventType = {
  /** A message started; parts carry no role, so consumers track it per message. */
  Message: 'message',
  /** A text or reasoning part was created or completed (`done`); `text` is the whole text so far. */
  Text: 'text',
  /** Streamed addition to a text or reasoning part. */
  TextDelta: 'text_delta',
  Tool: 'tool',
  StepFinished: 'step_finished',
  /** opencode waits before retrying a failed model request (e.g. rate limits). */
  Retry: 'retry',
  Idle: 'idle',
  Error: 'error',
  PermissionAsked: 'permission_asked',
  /** The runtime went away (crash or restart): every session it hosted is gone. */
  RuntimeLost: 'runtime_lost',
} as const;
export type OpencodeEventType = (typeof OpencodeEventType)[keyof typeof OpencodeEventType];

export const ToolCallStatus = {
  Pending: 'pending',
  Running: 'running',
  Completed: 'completed',
  Error: 'error',
} as const;
export type ToolCallStatus = (typeof ToolCallStatus)[keyof typeof ToolCallStatus];

export type OpencodeError = { name: string; data: Record<string, unknown> };

const E = OpencodeEventType;
export type OpencodeEvent =
  | {
      type: typeof E.Message;
      sessionId: string;
      messageId: string;
      role: 'user' | 'assistant';
      parentMessageId?: string;
    }
  | {
      type: typeof E.Text;
      sessionId: string;
      messageId: string;
      partId: string;
      kind: 'text' | 'reasoning';
      text: string;
      done: boolean;
    }
  | { type: typeof E.TextDelta; sessionId: string; messageId: string; partId: string; delta: string }
  | {
      type: typeof E.Tool;
      sessionId: string;
      messageId: string;
      partId: string;
      callId: string;
      tool: string;
      status: ToolCallStatus;
      input: Record<string, unknown>;
      output?: string;
      error?: string;
    }
  | {
      type: typeof E.StepFinished;
      sessionId: string;
      messageId: string;
      partId: string;
      tokens: { input: number; output: number };
      cost: number;
    }
  | { type: typeof E.Retry; sessionId: string; message: string | undefined }
  | { type: typeof E.Idle; sessionId: string }
  /** `error` is opencode's error object (`{ name, data }`), absent when opencode gives none. */
  | { type: typeof E.Error; sessionId: string; error: OpencodeError | undefined }
  | {
      type: typeof E.PermissionAsked;
      sessionId: string;
      directory: string;
      permissionId: string;
      messageId?: string;
      permission: string;
      patterns: string[];
    }
  | { type: typeof E.RuntimeLost };

// Schemas of the opencode 1.19.0 events we consume (shapes recorded in 12 §8); everything else is ignored.
const partBase = { id: z.string(), sessionID: z.string(), messageID: z.string() };
const partSchema = z.discriminatedUnion('type', [
  z.object({
    ...partBase,
    type: z.enum(['text', 'reasoning']),
    text: z.string(),
    time: z.object({ end: z.number().optional() }).optional(),
  }),
  z.object({
    ...partBase,
    type: z.literal('tool'),
    callID: z.string(),
    tool: z.string(),
    state: z.object({
      status: z.enum(ToolCallStatus),
      input: z.record(z.string(), z.unknown()),
      output: z.string().optional(),
      error: z.string().optional(),
    }),
  }),
  z.object({
    ...partBase,
    type: z.literal('step-finish'),
    cost: z.number(),
    tokens: z.object({ input: z.number(), output: z.number() }),
  }),
]);
const HANDLED_PART_TYPES: ReadonlySet<string> = new Set(['text', 'reasoning', 'tool', 'step-finish']);

const payloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message.updated'),
    properties: z.object({
      sessionID: z.string(),
      info: z.object({ id: z.string(), role: z.enum(['user', 'assistant']), parentID: z.string().optional() }),
    }),
  }),
  z.object({
    type: z.literal('message.part.updated'),
    properties: z.object({ part: z.looseObject({ type: z.string() }) }),
  }),
  z.object({
    type: z.literal('message.part.delta'),
    properties: z.object({
      sessionID: z.string(),
      messageID: z.string(),
      partID: z.string(),
      field: z.string(),
      delta: z.string(),
    }),
  }),
  z.object({
    type: z.literal('session.status'),
    properties: z.object({
      sessionID: z.string(),
      status: z.looseObject({ type: z.string(), message: z.string().optional() }),
    }),
  }),
  z.object({ type: z.literal('session.idle'), properties: z.object({ sessionID: z.string() }) }),
  z.object({
    type: z.literal('session.error'),
    properties: z.object({
      sessionID: z.string().optional(),
      error: z.object({ name: z.string(), data: z.record(z.string(), z.unknown()) }).optional(),
    }),
  }),
  z.object({
    type: z.literal('permission.asked'),
    properties: z.object({
      id: z.string(),
      sessionID: z.string(),
      permission: z.string(),
      patterns: z.array(z.string()),
      tool: z.object({ messageID: z.string() }).optional(),
    }),
  }),
]);
const HANDLED_TYPES: ReadonlySet<string> = new Set([
  'message.updated',
  'message.part.updated',
  'message.part.delta',
  'session.status',
  'session.idle',
  'session.error',
  'permission.asked',
]);

// Stream-level events (server.connected, heartbeats) carry no directory; instance events always do.
const globalEventSchema = z.object({
  directory: z.string().optional(),
  payload: z.looseObject({ type: z.string() }),
});

function toPartEvent(raw: unknown): OpencodeEvent | undefined {
  const part = partSchema.parse(raw);
  const ids = { sessionId: part.sessionID, messageId: part.messageID, partId: part.id };
  switch (part.type) {
    case 'text':
    case 'reasoning':
      return { type: E.Text, ...ids, kind: part.type, text: part.text, done: part.time?.end !== undefined };
    case 'tool':
      return {
        type: E.Tool,
        ...ids,
        callId: part.callID,
        tool: part.tool,
        status: part.state.status,
        input: part.state.input,
        ...(part.state.output === undefined ? {} : { output: part.state.output }),
        ...(part.state.error === undefined ? {} : { error: part.state.error }),
      };
    case 'step-finish':
      return { type: E.StepFinished, ...ids, tokens: part.tokens, cost: part.cost };
  }
}

/**
 * Translates one event of opencode's global stream. Returns undefined for events we do not consume; a consumed
 * event that does not match its schema throws (opencode is pinned to 1.19.0, so that is a contract change).
 */
export function parseGlobalEvent(raw: unknown): OpencodeEvent | undefined {
  const { directory, payload } = globalEventSchema.parse(raw);
  if (!HANDLED_TYPES.has(payload.type)) return undefined;
  const event = payloadSchema.parse(payload);
  switch (event.type) {
    case 'message.updated':
      return {
        type: E.Message,
        sessionId: event.properties.sessionID,
        messageId: event.properties.info.id,
        role: event.properties.info.role,
        ...(event.properties.info.parentID === undefined ? {} : { parentMessageId: event.properties.info.parentID }),
      };
    case 'message.part.updated':
      return HANDLED_PART_TYPES.has(event.properties.part.type) ? toPartEvent(event.properties.part) : undefined;
    case 'message.part.delta': {
      const p = event.properties;
      if (p.field !== 'text') return undefined;
      return { type: E.TextDelta, sessionId: p.sessionID, messageId: p.messageID, partId: p.partID, delta: p.delta };
    }
    case 'session.status': {
      const { sessionID, status } = event.properties;
      if (status.type !== 'retry') return undefined;
      return { type: E.Retry, sessionId: sessionID, message: status.message };
    }
    case 'session.idle':
      return { type: E.Idle, sessionId: event.properties.sessionID };
    case 'session.error': {
      const { sessionID, error } = event.properties;
      // Errors outside a session (e.g. provider auth at startup) concern no attempt.
      if (sessionID === undefined) return undefined;
      return { type: E.Error, sessionId: sessionID, error };
    }
    case 'permission.asked': {
      const p = event.properties;
      if (directory === undefined) throw new Error('permission.asked without a directory');
      return {
        type: E.PermissionAsked,
        sessionId: p.sessionID,
        directory,
        permissionId: p.id,
        ...(p.tool === undefined ? {} : { messageId: p.tool.messageID }),
        permission: p.permission,
        patterns: p.patterns,
      };
    }
  }
}
