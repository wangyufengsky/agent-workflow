import { MCP_ASSISTANT_TOOL_PREFIX, MCP_TOOL_PREFIX, McpToolName } from '@aw/shared';

export type ContextOwner = { kind: 'attempt' | 'assistant'; id: string; taskId: string | null };

export const recallToolName = (owner: ContextOwner) =>
  (owner.kind === 'attempt' ? MCP_TOOL_PREFIX : MCP_ASSISTANT_TOOL_PREFIX) + McpToolName.Recall;

export const ownerLog = (owner: ContextOwner) =>
  owner.kind === 'attempt' ? { attemptId: owner.id } : { conversationId: owner.id };
