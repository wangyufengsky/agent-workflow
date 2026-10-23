import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import {
  assistantTurnEventSchema,
  assistantTurnStatusSchema,
  mergePiece,
  type TranscriptEntry,
  TranscriptEntryKind,
} from '@aw/shared';
import type { OpencodeEvent } from '../packages/server/src/modules/opencode/index.ts';
import type { TestApp } from '../packages/server/test/helpers/app.ts';

/** 只读真实账本；HTTP 响应 latest 可能已指向下一条自动回传，不能拿它猜用户轮身份。 */
export function latestTurnId(db: DatabaseSync, conversationId: string): number {
  const row = db.prepare('SELECT max(id) AS id FROM assistant_turns WHERE conversation_id = ?').get(conversationId);
  assert.ok(row);
  assert.ok(row.id === null || typeof row.id === 'number');
  return row.id ?? 0;
}

export function newUserTurnId(db: DatabaseSync, conversationId: string, afterId: number): number | undefined {
  const rows = db
    .prepare("SELECT id FROM assistant_turns WHERE conversation_id = ? AND id > ? AND source = 'user'")
    .all(conversationId, afterId);
  assert.ok(rows.length <= 1, 'More than one user turn started for one evaluation request');
  const row = rows[0];
  if (row === undefined) return undefined;
  assert.ok(typeof row.id === 'number');
  return row.id;
}

/** 新会话的账本先于 native session 建立，只查状态，不能提前要求 native 身份存在。 */
export function statusOf(db: DatabaseSync, conversationId: string, turnId: number) {
  const row = db
    .prepare('SELECT status FROM assistant_turns WHERE conversation_id = ? AND id = ?')
    .get(conversationId, turnId);
  assert.ok(row);
  return assistantTurnStatusSchema.parse(row.status);
}

export function identityOf(db: DatabaseSync, conversationId: string, turnId: number) {
  const row = db
    .prepare(
      'SELECT t.id, t.source, t.status, t.end_reason AS endReason, t.message_ids AS messageIds, c.opencode_session_id AS sessionId FROM assistant_turns t JOIN assistant_conversations c ON c.id = t.conversation_id WHERE t.conversation_id = ? AND t.id = ?',
    )
    .get(conversationId, turnId);
  assert.ok(row);
  assert.ok(typeof row.id === 'number');
  assert.ok(row.source === 'user' || row.source === 'app');
  assert.ok(typeof row.messageIds === 'string');
  assert.ok(typeof row.sessionId === 'string');
  const messageIds: unknown = JSON.parse(row.messageIds);
  assert.ok(Array.isArray(messageIds) && messageIds.every((id: unknown) => typeof id === 'string'));
  const userMessageId: unknown = messageIds[0];
  assert.ok(typeof userMessageId === 'string', 'Missing persisted native user message id');
  return {
    id: row.id,
    source: row.source,
    status: assistantTurnStatusSchema.parse(row.status),
    endReason: assistantTurnEventSchema.parse(row.endReason),
    sessionId: row.sessionId,
    userMessageId,
  };
}
export type TurnIdentity = ReturnType<typeof identityOf>;

/** 同步 prompt 完成后只读原生已写入的最终 parts，作为独立 SSE/JSONL 的收齐依据。 */
export async function nativeTurnSnapshot(t: TestApp, conversationId: string, identity: TurnIdentity) {
  const { data } = await t.app.services.runtime.sdk().session.messages({
    sessionID: identity.sessionId,
    directory: t.app.services.assistant.filesDir(conversationId),
    limit: 100,
  });
  assert.ok(data, 'Native messages response did not contain data');
  assert.ok(
    data.some((message) => message.info.id === identity.userMessageId),
    'Native message window did not reach this turn',
  );
  const messages = data.filter(
    (message) => message.info.role === 'assistant' && message.info.parentID === identity.userMessageId,
  );
  const parts = messages.flatMap((message) => message.parts);
  return {
    identity,
    messages,
    texts: parts.flatMap((part) =>
      part.type === 'text' || part.type === 'reasoning' ? [{ partId: part.id, kind: part.type, text: part.text }] : [],
    ),
    tools: parts.flatMap((part) => (part.type === 'tool' ? [part] : [])),
    steps: parts.flatMap((part) => (part.type === 'step-finish' ? [part.id] : [])),
  };
}
export type NativeTurnSnapshot = Awaited<ReturnType<typeof nativeTurnSnapshot>>;

/** 只收本轮 partId/callId；旧轮迟到 SSE 的 seq 再大也不能混入本轮回复和工具证据。 */
export function scopedEntries(snapshot: NativeTurnSnapshot, entries: readonly TranscriptEntry[]): TranscriptEntry[] {
  const parts = new Set(snapshot.texts.map((part) => part.partId));
  const calls = new Set(snapshot.tools.map((part) => part.callID));
  return entries.filter((entry) => {
    if (entry.kind === TranscriptEntryKind.Text || entry.kind === TranscriptEntryKind.Reasoning)
      return parts.has(entry.partId);
    if (entry.kind === TranscriptEntryKind.ToolCall || entry.kind === TranscriptEntryKind.ToolResult)
      return calls.has(entry.data.callId);
    return false;
  });
}

export function transcriptCaughtUp(
  snapshot: NativeTurnSnapshot,
  entries: readonly TranscriptEntry[],
  nativeEvents: readonly OpencodeEvent[],
): boolean {
  const pieces = new Map<string, { text: string; offset: number }>();
  for (const entry of entries) {
    if (entry.kind !== TranscriptEntryKind.Text && entry.kind !== TranscriptEntryKind.Reasoning) continue;
    const previous = pieces.get(entry.partId);
    pieces.set(entry.partId, previous === undefined ? entry.data : mergePiece(previous, entry.data));
  }
  return (
    snapshot.texts.every((part) => (pieces.get(part.partId)?.text ?? '') === part.text) &&
    snapshot.tools.every((part) => {
      const { state } = part;
      if (state.status !== 'completed' && state.status !== 'error') return false;
      const called = entries.some(
        (entry) => entry.kind === TranscriptEntryKind.ToolCall && entry.data.callId === part.callID,
      );
      return (
        called &&
        entries.some(
          (entry) =>
            entry.kind === TranscriptEntryKind.ToolResult &&
            entry.data.callId === part.callID &&
            entry.data.status === state.status &&
            (state.status === 'completed' ? entry.data.output === state.output : entry.data.error === state.error),
        )
      );
    }) &&
    snapshot.steps.every((partId) =>
      nativeEvents.some(
        (event) =>
          event.type === 'step_finished' && event.sessionId === snapshot.identity.sessionId && event.partId === partId,
      ),
    )
  );
}
