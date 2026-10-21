import { MCP_TOOL_PREFIX, McpToolName, type TranscriptEntry, TranscriptEntryKind } from '@aw/shared';

/** The four stages of a research turn shown on its process card (18 §2.1). */
export type ResearchStep = 'understand' | 'search' | 'read' | 'answer';
export const RESEARCH_STEPS: readonly ResearchStep[] = ['understand', 'search', 'read', 'answer'];

export type ResearchProgress = {
  current: ResearchStep;
  searches: number;
  /** Files, pages and queries read, in order, each once. */
  reads: string[];
  /** The latest `submit_answer` was rejected and the researcher is fixing its citations. */
  rejected: boolean;
};

const mcp = (name: McpToolName) => `${MCP_TOOL_PREFIX}${name}`;
const SEARCH_TOOLS = new Set([
  'grep',
  'glob',
  'list',
  'codesearch',
  'websearch',
  mcp(McpToolName.DbListConnections),
  mcp(McpToolName.DbDescribe),
]);
const SEARCH_COMMANDS = /^(rg|grep|find|ls|git grep|git log)\b/;
const READ_COMMANDS = /^(cat|head|tail|git show)\b/;
const SUBMIT = mcp(McpToolName.SubmitAnswer);

const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

/** What a tool call contributes: a search, a source read (its label), or nothing. */
function classify(tool: string, input: Record<string, unknown>): 'search' | { read: string } | undefined {
  if (SEARCH_TOOLS.has(tool)) return 'search';
  if (tool === 'read') return { read: text(input.filePath) ?? tool };
  if (tool === 'webfetch') return { read: text(input.url) ?? tool };
  if (tool === mcp(McpToolName.DbQuery)) return { read: text(input.sql) ?? tool };
  if (tool === 'bash') {
    const command = (text(input.command) ?? '').trim();
    if (READ_COMMANDS.test(command)) return { read: command };
    if (SEARCH_COMMANDS.test(command)) return 'search';
  }
  return undefined;
}

/**
 * The research stages from the turn's session stream (18 §2.1): no extra reporting by the model, only its tool calls.
 * `basePath` (the repository) is cut from file paths so they read as the citations do.
 */
export function researchSteps(entries: readonly TranscriptEntry[], basePath: string): ResearchProgress {
  let searches = 0;
  const reads: string[] = [];
  let submitted = false;
  let rejected = false;
  const prefix = basePath.endsWith('/') ? basePath : `${basePath}/`;
  for (const entry of entries) {
    if (entry.kind === TranscriptEntryKind.ToolResult && entry.data.tool === SUBMIT) {
      rejected = entry.data.status === 'error';
      continue;
    }
    if (entry.kind !== TranscriptEntryKind.ToolCall) continue;
    if (entry.data.tool === SUBMIT) {
      submitted = true;
      continue;
    }
    const kind = classify(entry.data.tool, entry.data.input);
    if (kind === 'search') searches++;
    else if (kind !== undefined) {
      const label = kind.read.startsWith(prefix) ? kind.read.slice(prefix.length) : kind.read;
      if (!reads.includes(label)) reads.push(label);
    }
  }
  const current: ResearchStep = submitted
    ? 'answer'
    : reads.length > 0
      ? 'read'
      : searches > 0
        ? 'search'
        : 'understand';
  return { current, searches, reads, rejected };
}
