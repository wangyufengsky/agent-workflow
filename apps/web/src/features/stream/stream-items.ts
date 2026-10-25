import {
  type ErrorInfo,
  MCP_TOOL_PREFIX,
  McpToolName,
  type TranscriptEntry,
  TranscriptEntryKind,
  TranscriptSystemEvent,
} from '@aw/shared';

/** What a tool call did, in the user's words (14 §3.4「过程」); the copy turns it into one line. */
export type ToolAction =
  | { kind: 'edit'; path: string; added: number; removed: number }
  | { kind: 'write'; path: string; lines: number }
  | { kind: 'read'; path: string }
  | { kind: 'run'; command: string }
  | { kind: 'search'; query: string }
  | { kind: 'fetch'; url: string }
  | { kind: 'todo' }
  | { kind: 'app'; name: McpToolName; detail?: string }
  | { kind: 'other'; tool: string };

/** The frame a browser action's result names (`"frame":"f3.jpg"`, 12 §6.17). */
const FRAME_IN_RESULT = /"frame":"(f\d+\.jpg)"/;

/** A tool call's outcome; `stopped`: the session ended before it reported one. */
export type ActionState = 'running' | 'ok' | 'failed' | 'stopped';

export type StreamAction = {
  kind: 'action';
  key: string;
  action: ToolAction;
  state: ActionState;
  /** The raw call, shown in pro mode and, for a failed call, its error. */
  tool: string;
  input: Record<string, unknown>;
  output: string | undefined;
  /** A browser action's frame (29 §5.7, §8.3), named in its result. */
  frame?: string;
};

/** One item of the conversation stream (25 §3.1). */
export type StreamItem =
  | { kind: 'text'; key: string; text: string; writing: boolean }
  /** `seconds`: from the line before it to its last line. */
  | { kind: 'thinking'; key: string; text: string; seconds: number; writing: boolean }
  | StreamAction
  /** Three or more calls in a row of an ended stream, folded into one line. */
  | { kind: 'group'; key: string; actions: StreamAction[] }
  /** What we sent the session; pro mode only. */
  | { kind: 'prompt'; key: string; text: string }
  /** `waiting`: the session still waits for the answer. */
  | { kind: 'wait'; key: string; permission: string; patterns: string[]; waiting: boolean }
  /** A `report_progress` line. */
  | { kind: 'progress'; key: string; text: string }
  /** `waiting`: the session stopped here for your answer (`awaiting_input` last, nothing came after). */
  /** `detail`: what the event comes with, e.g. the model service's reason for a retry (D163). */
  | { kind: 'notice'; key: string; event: TranscriptSystemEvent; detail?: string; waiting: boolean }
  | { kind: 'error'; key: string; error: ErrorInfo };

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const lines = (value: string) => (value === '' ? 0 : value.replace(/\n$/, '').split('\n').length);

/** Lines added and removed by replacing `before` with `after`, ignoring the lines both start and end with. */
export function lineDelta(before: string, after: string): { added: number; removed: number } {
  const a = before === '' ? [] : before.replace(/\n$/, '').split('\n');
  const b = after === '' ? [] : after.replace(/\n$/, '').split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return { added: b.length - start - end, removed: a.length - start - end };
}

const APP_TOOLS = new Map<string, McpToolName>(Object.values(McpToolName).map((n) => [`${MCP_TOOL_PREFIX}${n}`, n]));

/** opencode's native tools (1.19.0) and our execution MCP tools; anything else keeps its name. */
export function toolAction(
  tool: string,
  input: Record<string, unknown>,
  relative: (path: string) => string,
): ToolAction {
  const path = () => relative(text(input.filePath) || text(input.path));
  switch (tool) {
    case 'edit':
      return { kind: 'edit', path: path(), ...lineDelta(text(input.oldString), text(input.newString)) };
    case 'write':
      return { kind: 'write', path: path(), lines: lines(text(input.content)) };
    case 'read':
      return { kind: 'read', path: path() };
    case 'bash':
      return { kind: 'run', command: text(input.command).trim().split('\n')[0] ?? '' };
    case 'grep':
    case 'glob':
    case 'codesearch':
    case 'websearch':
      return { kind: 'search', query: text(input.pattern) || text(input.query) };
    case 'list':
      return { kind: 'read', path: path() || '.' };
    case 'webfetch':
      return { kind: 'fetch', url: text(input.url) };
    case 'todowrite':
    case 'todoread':
      return { kind: 'todo' };
  }
  const name = APP_TOOLS.get(tool);
  if (name === undefined) return { kind: 'other', tool };
  const detail = APP_TOOL_DETAIL[name]?.(input);
  return detail === undefined ? { kind: 'app', name } : { kind: 'app', name, detail };
}

/** What a call of our tool works on, shown after its label:「打开页面 /orders」「输入 R-1001」. */
const APP_TOOL_DETAIL: Partial<Record<McpToolName, (input: Record<string, unknown>) => string>> = {
  [McpToolName.ReportProgress]: (input) => text(input.message),
  [McpToolName.DbQuery]: (input) => text(input.sql),
  [McpToolName.BrowserOpen]: (input) => text(input.url),
  [McpToolName.BrowserType]: (input) => text(input.text),
  [McpToolName.BrowserPress]: (input) => text(input.key),
  [McpToolName.BrowserWaitFor]: (input) => text(input.text) || text(input.textGone),
  [McpToolName.BrowserViewport]: (input) => text(input.preset),
  [McpToolName.BrowserSelect]: (input) => (Array.isArray(input.values) ? input.values.map(String).join('、') : ''),
};

const slashed = (path: string) => path.replaceAll('\\', '/');

/** Cuts the session's directory from file paths, also for the native `C:\…` paths opencode reports on Windows. */
export function relativeTo(directory: string): (path: string) => string {
  const base = slashed(directory);
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return (path) => {
    const p = slashed(path);
    return p.startsWith(prefix) ? p.slice(prefix.length) : p;
  };
}

/** Session start is implied by the first line. */
const QUIET_EVENTS = new Set<TranscriptSystemEvent>([TranscriptSystemEvent.AttemptStarted]);
/** Calls in a row of an ended stream that fold into a group (25 §4.3). */
export const GROUP_MIN_ACTIONS = 3;

const isProgress = (tool: string) => tool === `${MCP_TOOL_PREFIX}${McpToolName.ReportProgress}`;

/** Seconds a reasoning part took: from the line before it to its last line. */
const secondsOf = (entry: TranscriptEntry, before: TranscriptEntry | undefined) =>
  Math.max(1, Math.round((entry.ts - (before?.ts ?? entry.ts)) / 1000));

/** How long each reasoning part of a stream took, by `partId` (the assistant panel's thinking blocks). */
export function thinkingSeconds(entries: readonly TranscriptEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  entries.forEach((e, i) => {
    if (e.kind === TranscriptEntryKind.Reasoning) out.set(e.partId, secondsOf(e, entries[i - 1]));
  });
  return out;
}

/** Folds runs of `GROUP_MIN_ACTIONS` or more calls into groups. */
function grouped(items: StreamItem[]): StreamItem[] {
  const out: StreamItem[] = [];
  let run: StreamAction[] = [];
  const close = () => {
    const first = run[0];
    if (first !== undefined && run.length >= GROUP_MIN_ACTIONS)
      out.push({ kind: 'group', key: first.key, actions: run });
    else out.push(...run);
    run = [];
  };
  for (const item of items) {
    if (item.kind === 'action') {
      run.push(item);
      continue;
    }
    close();
    out.push(item);
  }
  close();
  return out;
}

/**
 * The session as the stream shows it (25 §3.1, §5): text, thinking, one action per tool call with its outcome,
 * permission requests, progress lines, notices and errors; what we sent the session only in pro mode. While the
 * session runs, its last text or thinking is being written; once it ended, calls in a row fold into groups.
 */
export function streamItems(
  entries: readonly TranscriptEntry[],
  { directory, pro, ended }: { directory: string; pro: boolean; ended: boolean },
): StreamItem[] {
  const relative = relativeTo(directory);
  const results = new Map<string, Extract<TranscriptEntry, { kind: typeof TranscriptEntryKind.ToolResult }>>();
  for (const e of entries) if (e.kind === TranscriptEntryKind.ToolResult) results.set(e.data.callId, e);
  const items: StreamItem[] = [];
  entries.forEach((e, i) => {
    const key = 'partId' in e ? e.partId : String(e.seq);
    switch (e.kind) {
      case TranscriptEntryKind.Text:
        if (e.data.text.trim() !== '') items.push({ kind: 'text', key, text: e.data.text, writing: false });
        break;
      case TranscriptEntryKind.Reasoning:
        if (e.data.text.trim() !== '')
          items.push({
            kind: 'thinking',
            key,
            text: e.data.text,
            seconds: secondsOf(e, entries[i - 1]),
            writing: false,
          });
        break;
      case TranscriptEntryKind.UserMessage:
        if (pro) items.push({ kind: 'prompt', key, text: e.data.text });
        break;
      case TranscriptEntryKind.ToolCall: {
        const { tool, input, callId } = e.data;
        if (isProgress(tool)) {
          items.push({ kind: 'progress', key, text: typeof input.message === 'string' ? input.message : '' });
          break;
        }
        const result = results.get(callId);
        const state: ActionState =
          result === undefined ? (ended ? 'stopped' : 'running') : result.data.status === 'error' ? 'failed' : 'ok';
        const output = result?.data.status === 'error' ? result.data.error : result?.data.output;
        const frame = state === 'ok' ? FRAME_IN_RESULT.exec(output ?? '')?.[1] : undefined;
        items.push({
          kind: 'action',
          key,
          action: toolAction(tool, input, relative),
          state,
          tool,
          input,
          output,
          ...(frame === undefined ? {} : { frame }),
        });
        break;
      }
      case TranscriptEntryKind.Permission:
        items.push({ kind: 'wait', key, permission: e.data.permission, patterns: e.data.patterns, waiting: false });
        break;
      case TranscriptEntryKind.System:
        if (QUIET_EVENTS.has(e.data.event)) break;
        items.push({
          kind: 'notice',
          key,
          event: e.data.event,
          ...(e.data.detail === undefined ? {} : { detail: e.data.detail }),
          waiting: false,
        });
        break;
      case TranscriptEntryKind.Error:
        items.push({ kind: 'error', key, error: e.data });
        break;
      default:
        break;
    }
  });
  if (ended) return grouped(items);
  const last = items.at(-1);
  if (last?.kind === 'text' || last?.kind === 'thinking') items[items.length - 1] = { ...last, writing: true };
  // A further permission asked while the session already waits gets no notice of its own.
  else if (last?.kind === 'wait') items[items.length - 1] = { ...last, waiting: true };
  else if (last?.kind === 'notice' && last.event === TranscriptSystemEvent.AwaitingInput) {
    // The session parks right after a permission request (attempts.state.ts): the request shows the wait itself.
    const before = items.at(-2);
    if (before?.kind === 'wait') items.splice(-2, 2, { ...before, waiting: true });
    else items[items.length - 1] = { ...last, waiting: true };
  }
  return items;
}
