import { MCP_TOOL_PREFIX } from '../constants/opencode.ts';
import type { TranscriptEntry } from '../contracts/api/attempts.ts';
import { McpToolName } from '../contracts/mcp/names.ts';
import { TranscriptEntryKind } from '../enums/system.ts';

const SUBMIT = `${MCP_TOOL_PREFIX}${McpToolName.SubmitAnswer}`;

/**
 * The answer draft of a research turn (18 §5.5): the text the researcher wrote after its last tool call other than
 * `submit_answer`. Remarks between tool calls stop being the draft once the next tool call comes; undefined while
 * there is none. `entries` are in transcript order, each streaming part once (its latest text).
 */
export function answerDraft(entries: readonly TranscriptEntry[]): string | undefined {
  let start = 0;
  entries.forEach((entry, i) => {
    if (entry.kind === TranscriptEntryKind.ToolCall && entry.data.tool !== SUBMIT) start = i + 1;
  });
  const texts = entries
    .slice(start)
    .flatMap((entry) =>
      entry.kind === TranscriptEntryKind.Text && entry.data.text.trim() !== '' ? [entry.data.text] : [],
    );
  return texts.length === 0 ? undefined : texts.join('\n\n');
}
