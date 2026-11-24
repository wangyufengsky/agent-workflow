import {
  ErrorCode,
  pieceBetween,
  TRANSCRIPT_TEXT_FLUSH_CHARS,
  TranscriptEntryKind,
  TranscriptSystemEvent,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import {
  CONTEXT_OVERFLOW_ERROR,
  describeOpencodeError,
  OpencodeEventType as E,
  type OpencodeEvent,
  ToolCallStatus,
} from '../opencode/index.ts';
import type { NewTranscriptEntry } from './attempts.transcript.ts';

type TextPart = {
  kind: typeof TranscriptEntryKind.Text | typeof TranscriptEntryKind.Reasoning;
  text: string;
  /** The text the part's lines add up to so far. */
  written: string;
};

/**
 * What one session has streamed so far, enough to turn its events into transcript entries (10 §3):
 * the role of each message (our own prompts are recorded when sent, so user parts are skipped), the text of
 * streaming parts (what they grew by, written every `TRANSCRIPT_TEXT_FLUSH_CHARS` characters, D104), which tool
 * calls were already recorded, and why opencode is retrying: while the model service stays down opencode retries for
 * as long as it takes, and the same reason is recorded once (D163).
 */
export function createSessionView() {
  const roles = new Map<string, 'user' | 'assistant'>();
  const parts = new Map<string, TextPart>();
  const activeCalls = new Map<string, Extract<OpencodeEvent, { type: typeof E.Tool }>>();
  const callEvents = new EventTarget();
  const calledTools = new Set<string>();
  /** The reason of the retry in progress; cleared by anything the session does other than sending the request. */
  let retrying: string | undefined;

  const textEntry = (partId: string, part: TextPart): NewTranscriptEntry => {
    const data = pieceBetween(part.written, part.text);
    part.written = part.text;
    return { kind: part.kind, partId, data };
  };

  return {
    async permissionCall(id: string | undefined, clock: Clock, signal: AbortSignal) {
      if (!id || signal.aborted) return;
      const existing = activeCalls.get(id);
      if (existing) return existing;
      // 原生权限事件可能早于同一调用的 running 事件。只接收已关联的调用。
      await new Promise<void>((resolve) => {
        const finish = () => {
          cancel();
          signal.removeEventListener('abort', finish);
          callEvents.removeEventListener(id, finish);
          resolve();
        };
        const cancel = clock.schedule(1000, finish);
        signal.addEventListener('abort', finish, { once: true });
        callEvents.addEventListener(id, finish, { once: true });
      });
      return activeCalls.get(id);
    },
    toEntries(event: OpencodeEvent): NewTranscriptEntry[] {
      if (event.type !== E.Retry && event.type !== E.Busy) retrying = undefined;
      switch (event.type) {
        case E.Message:
          roles.set(event.messageId, event.role);
          return [];
        case E.Text: {
          if (roles.get(event.messageId) !== 'assistant') return [];
          const kind = event.kind === 'text' ? TranscriptEntryKind.Text : TranscriptEntryKind.Reasoning;
          const part = parts.get(event.partId) ?? { kind, text: '', written: '' };
          parts.set(event.partId, part);
          part.text = event.text;
          // The opening update is empty; the closing one carries the full text, of which the rest is written.
          return event.done && part.text !== part.written ? [textEntry(event.partId, part)] : [];
        }
        case E.TextDelta: {
          const part = parts.get(event.partId);
          if (part === undefined) return [];
          part.text += event.delta;
          return part.text.length - part.written.length >= TRANSCRIPT_TEXT_FLUSH_CHARS
            ? [textEntry(event.partId, part)]
            : [];
        }
        case E.Tool: {
          const { callId, tool } = event;
          if (event.status === ToolCallStatus.Running) {
            activeCalls.set(callId, event);
            callEvents.dispatchEvent(new Event(callId));
          } else if (event.status !== ToolCallStatus.Pending) activeCalls.delete(callId);
          if (event.status === ToolCallStatus.Pending) return [];
          if (event.status === ToolCallStatus.Running) {
            if (calledTools.has(callId)) return [];
            calledTools.add(callId);
            return [{ kind: TranscriptEntryKind.ToolCall, data: { tool, callId, input: event.input } }];
          }
          return [
            {
              kind: TranscriptEntryKind.ToolResult,
              data: {
                tool,
                callId,
                status: event.status,
                ...(event.output === undefined ? {} : { output: event.output }),
                ...(event.error === undefined ? {} : { error: event.error }),
              },
            },
          ];
        }
        case E.PermissionAsked:
          return [
            {
              kind: TranscriptEntryKind.Permission,
              data: { permissionId: event.permissionId, permission: event.permission, patterns: event.patterns },
            },
          ];
        case E.Retry:
          if (retrying !== undefined && retrying === event.message) return [];
          retrying = event.message;
          return [
            {
              kind: TranscriptEntryKind.System,
              data: {
                event: TranscriptSystemEvent.Retrying,
                ...(event.message === undefined ? {} : { detail: event.message }),
              },
            },
          ];
        case E.Stalled:
          return [{ kind: TranscriptEntryKind.System, data: { event: TranscriptSystemEvent.ModelStalled } }];
        case E.Error:
          return [
            {
              kind: TranscriptEntryKind.Error,
              data: {
                code: ErrorCode.AttemptSessionError,
                message: describeOpencodeError(event.error),
                ...(event.error === undefined
                  ? {}
                  : {
                      details:
                        event.error.name === CONTEXT_OVERFLOW_ERROR
                          ? { ...event.error.data, opencodeErrorName: event.error.name }
                          : event.error.data,
                    }),
              },
            },
          ];
        case E.StepFinished:
        case E.Compacted:
        case E.Busy:
        case E.PermissionReplied:
        case E.Idle:
        case E.RuntimeLost:
          return [];
      }
    },
  };
}
export type SessionView = ReturnType<typeof createSessionView>;
