import {
  AssistantToolName,
  assistantToolName,
  MCP_ASSISTANT_TOOL_PREFIX,
  OPERATION_CONTRACTS,
  type OperationContract,
} from '@aw/shared';
import { TOOL_COPY } from '../../copy/assistant.ts';
import { operationTitle } from '../../copy/operations.ts';

const OPERATION_BY_TOOL = new Map<string, OperationContract>(
  OPERATION_CONTRACTS.map((c) => [`${MCP_ASSISTANT_TOOL_PREFIX}${assistantToolName(c.id)}`, c] as const),
);
const APP_TOOLS: ReadonlySet<string> = new Set(Object.values(AssistantToolName));
const isAppTool = (name: string): name is AssistantToolName => APP_TOOLS.has(name);

/** Input fields of opencode's own tools that say what the call is about, in order of preference. */
const SUBJECT_FIELDS = ['filePath', 'path', 'command', 'pattern', 'url', 'query'] as const;
const PATH_FIELDS: ReadonlySet<string> = new Set(['filePath', 'path']);

export type ToolInfo = {
  /** What the call does, in words; the internal tool name stays in pro mode's details (15 §6). */
  title: string;
  /** Set for the app's operations: their inputs read with the confirmation card's labels. */
  operation?: OperationContract;
  /** The file, command or address a native tool works on. */
  subject?: string;
};

function subjectOf(input: Record<string, unknown>): string | undefined {
  for (const field of SUBJECT_FIELDS) {
    const value = input[field];
    if (typeof value !== 'string' || value === '') continue;
    // Absolute paths of the assistant's files directory say little; the file name is what the user knows.
    return PATH_FIELDS.has(field) ? (value.split(/[\\/]/).at(-1) ?? value) : value;
  }
  return undefined;
}

/** How a tool call of the assistant reads in the panel: an operation's title, the app tool's verb, or opencode's. */
export function describeTool(tool: string, input: Record<string, unknown>): ToolInfo {
  const operation = OPERATION_BY_TOOL.get(tool);
  if (operation !== undefined) return { title: operationTitle(operation.title), operation };
  const appName = tool.startsWith(MCP_ASSISTANT_TOOL_PREFIX) ? tool.slice(MCP_ASSISTANT_TOOL_PREFIX.length) : tool;
  if (isAppTool(appName)) return { title: TOOL_COPY.app[appName] };
  const native = TOOL_COPY.native[tool];
  const subject = subjectOf(input);
  return {
    title: native ?? TOOL_COPY.external,
    ...(subject === undefined ? {} : { subject }),
  };
}
