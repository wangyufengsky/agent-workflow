import { ErrorCode, TRANSCRIPT_TEXT_FLUSH_CHARS, TranscriptEntryKind, TranscriptSystemEvent } from '@aw/shared';
import { OpencodeEventType as E, type OpencodeEvent, ToolCallStatus } from '../opencode/index.ts';
import type { NewTranscriptEntry } from './attempts.transcript.ts';

type TextPart = {
  kind: typeof TranscriptEntryKind.Text | typeof TranscriptEntryKind.Reasoning;
  text: string;
  written: number;
};

/**
 * What one session has streamed so far, enough to turn its events into transcript entries (10 §3):
 * the role of each message (our own prompts are recorded when sent, so user parts are skipped), the text of
 * streaming parts (written every `textFlushChars` characters), and which tool calls were already recorded.
 */
export function createSessionView(textFlushChars: number = TRANSCRIPT_TEXT_FLUSH_CHARS) {
  const roles = new Map<string, 'user' | 'assistant'>();
  const parts = new Map<string, TextPart>();
  const calledTools = new Set<string>();

  const textEntry = (partId: string, part: TextPart): NewTranscriptEntry => {
    part.written = part.text.length;
    return { kind: part.kind, partId, data: { text: part.text } };
  };

  return {
    toEntries(event: OpencodeEvent): NewTranscriptEntry[] {
      switch (event.type) {
        case E.Message:
          roles.set(event.messageId, event.role);
          return [];
        case E.Text: {
          if (roles.get(event.messageId) !== 'assistant') return [];
          const kind = event.kind === 'text' ? TranscriptEntryKind.Text : TranscriptEntryKind.Reasoning;
          const part = parts.get(event.partId) ?? { kind, text: '', written: 0 };
          parts.set(event.partId, part);
          part.text = event.text;
          // The opening update is empty; the closing one carries the full text.
          return event.done && part.text !== '' ? [textEntry(event.partId, part)] : [];
        }
        case E.TextDelta: {
          const part = parts.get(event.partId);
          if (part === undefined) return [];
          part.text += event.delta;
          return part.text.length - part.written >= textFlushChars ? [textEntry(event.partId, part)] : [];
        }
        case E.Tool: {
          const { callId, tool } = event;
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
          return [
            {
              kind: TranscriptEntryKind.System,
              data: {
                event: TranscriptSystemEvent.Retrying,
                ...(event.message === undefined ? {} : { detail: event.message }),
              },
            },
          ];
        case E.Error:
          return [
            {
              kind: TranscriptEntryKind.Error,
              data: {
                code: ErrorCode.AttemptSessionError,
                message: event.error?.name ?? 'session error',
                ...(event.error === undefined ? {} : { details: event.error.data }),
              },
            },
          ];
        case E.StepFinished:
        case E.Idle:
        case E.RuntimeLost:
          return [];
      }
    },
  };
}
export type SessionView = ReturnType<typeof createSessionView>;
