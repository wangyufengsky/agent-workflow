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

export type ActionState = 'running' | 'ok' | 'failed';

/** One line of the simple process view: the AI's text, a tool action with its outcome, or a notice. */
export type ProcessLine =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'action'; key: string; action: ToolAction; state: ActionState }
  | { kind: 'permission'; key: string; permission: string; patterns: string[] }
  | { kind: 'system'; key: string; event: TranscriptSystemEvent }
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
  if (name === McpToolName.ReportProgress) return { kind: 'app', name, detail: text(input.message) };
  if (name === McpToolName.DbQuery) return { kind: 'app', name, detail: text(input.sql) };
  return { kind: 'app', name };
}

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

/**
 * The session as the simple view shows it (14 §3.4): the AI's text and one line per tool call with its outcome; the
 * prompts we send, reasoning and the session's bookkeeping are left to the pro view.
 */
export function processLines(entries: readonly TranscriptEntry[], directory: string): ProcessLine[] {
  const relative = relativeTo(directory);
  const results = new Map<string, ActionState>();
  for (const e of entries) {
    if (e.kind === TranscriptEntryKind.ToolResult)
      results.set(e.data.callId, e.data.status === 'error' ? 'failed' : 'ok');
  }
  const out: ProcessLine[] = [];
  for (const e of entries) {
    const key = 'partId' in e ? e.partId : String(e.seq);
    switch (e.kind) {
      case TranscriptEntryKind.Text:
        if (e.data.text.trim() !== '') out.push({ kind: 'text', key, text: e.data.text });
        break;
      case TranscriptEntryKind.ToolCall:
        out.push({
          kind: 'action',
          key,
          action: toolAction(e.data.tool, e.data.input, relative),
          state: results.get(e.data.callId) ?? 'running',
        });
        break;
      case TranscriptEntryKind.Permission:
        out.push({ kind: 'permission', key, permission: e.data.permission, patterns: e.data.patterns });
        break;
      case TranscriptEntryKind.System:
        if (!QUIET_EVENTS.has(e.data.event)) out.push({ kind: 'system', key, event: e.data.event });
        break;
      case TranscriptEntryKind.Error:
        out.push({ kind: 'error', key, error: e.data });
        break;
      default:
        break;
    }
  }
  return out;
}
