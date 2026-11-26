import type { ProjectionReceipt } from '../contracts/api/context.ts';
import { bytes, historySize, SUMMARY_LABEL } from './budget.ts';
import { hasModelContent, type Messages } from './messages.ts';

type Part = Messages[number]['parts'][number];

export function requestRecallTool(tool: string | undefined, tools: Record<string, boolean> | undefined) {
  return tool && tools?.[tool] !== false ? tool : undefined;
}

function readPath(part: Part, messageId: string): string | undefined {
  if (
    part.type !== 'tool' ||
    part.tool !== 'read' ||
    part.messageID !== messageId ||
    !part.callID ||
    !part.id ||
    part.state.status !== 'completed' ||
    Object.keys(part.metadata ?? {}).length
  )
    return undefined;
  const { state } = part;
  const { loaded, display } = state.metadata;
  if (Object.keys(state.metadata).some((key) => !['loaded', 'display', 'preview', 'truncated'].includes(key)))
    return undefined;
  if (
    !Array.isArray(loaded) ||
    loaded.length ||
    typeof display !== 'object' ||
    display === null ||
    !('type' in display) ||
    display.type !== 'file' ||
    !('path' in display) ||
    typeof display.path !== 'string' ||
    typeof state.output !== 'string' ||
    state.attachments?.length ||
    state.time.compacted !== undefined ||
    state.output.includes('<system-reminder>') ||
    /(?:^|[/\\])(?:agents\.md|claude\.md|context\.md|copilot-instructions\.md)$/i.test(display.path)
  )
    return undefined;
  return display.path;
}

export function referenceText(part: Part, messageId: string, recallTool: string | undefined): string | undefined {
  const path = readPath(part, messageId);
  return path && recallTool
    ? `[AW read messageId=${messageId} partId=${part.id} path=${path} → ${recallTool}]`
    : undefined;
}

/** 从旧到新只释放超出预算的字节，保留最新工具批次及其中的兄弟调用。 */
export function projectHistory(messages: Messages, recallTool: string | undefined, excessBytes: number): Messages {
  if (!recallTool || excessBytes <= 0) return messages;
  const latest = messages.findLastIndex((m) => m.parts.some((p) => p.type === 'tool'));
  return messages.map((m, i) => {
    if (
      excessBytes <= 0 ||
      i >= latest ||
      m.info.role !== 'assistant' ||
      m.info.summary ||
      m.info.error ||
      m.info.time.completed === undefined ||
      m.parts.some(
        (p) =>
          p.messageID !== m.info.id ||
          p.sessionID !== m.info.sessionID ||
          (p.type === 'reasoning' && Object.keys(p.metadata ?? {}).length > 0) ||
          (p.type === 'tool' && p.state.status !== 'completed'),
      )
    )
      return m;
    const parts = m.parts.map((p) => {
      if (excessBytes <= 0 || p.type !== 'tool' || p.state.status !== 'completed') return p;
      const output = referenceText(p, m.info.id, recallTool);
      if (output === undefined) return p;
      const saved = bytes(p.state.output) - bytes(output);
      if (saved <= 0) return p;
      excessBytes -= saved;
      return { ...p, state: { ...p.state, output } };
    });
    return { ...m, parts };
  });
}

export type Summary = { uptoMessageId: string; summaryText: string };

const MIN_SOURCE_BYTES = 1024;
const MAX_SOURCE_BYTES = 192 * 1024;

// 只投影闭合的普通文本和工具批次。规则、附件、带签名的消息留在原位。
export function eligible({ info, parts }: Messages[number]): boolean {
  if (info.role === 'assistant' && (info.summary || info.error || info.time.completed === undefined)) return false;
  if (!parts.some((p) => p.type === 'text' || p.type === 'tool')) return false;
  return parts.every((p) => {
    if (
      p.messageID !== info.id ||
      p.sessionID !== info.sessionID ||
      ('metadata' in p && Object.keys(p.metadata ?? {}).length)
    )
      return false;
    switch (p.type) {
      case 'step-start':
      case 'step-finish':
      case 'reasoning':
        return true;
      case 'text':
        return !p.ignored && !p.synthetic && !p.text.includes('<system-reminder>');
      case 'tool':
        return (
          p.state.status === 'completed' &&
          !p.state.attachments?.length &&
          p.state.time.compacted === undefined &&
          !p.state.output.includes('<system-reminder>') &&
          (p.tool !== 'read' || readPath(p, info.id) !== undefined)
        );
      default:
        return false;
    }
  });
}

function protectedMessages(messages: Messages) {
  const tool = messages.findLastIndex((m) => m.parts.some((p) => p.type === 'tool'));
  const user = messages.findLastIndex((m) => m.info.role === 'user');
  const firstUser = messages.findIndex((m) => m.info.role === 'user');
  return { firstUser, tool, user, tail: Math.max(tool, user) };
}

export function applySummary(messages: Messages, summary?: Summary): Messages {
  if (!summary) return messages;
  const end = messages.findIndex((m) => m.info.id === summary.uptoMessageId);
  const anchor = messages[end];
  const part = anchor?.parts[0];
  const { firstUser, tool, user, tail } = protectedMessages(messages);
  if (anchor?.info.role !== 'assistant' || !part || end === tool || end >= tail || !eligible(anchor)) return messages;
  const text: Part = {
    type: 'text',
    id: part.id,
    sessionID: part.sessionID,
    messageID: part.messageID,
    text: SUMMARY_LABEL + summary.summaryText,
  };
  return [
    ...messages.slice(0, end).filter((m, i) => i === firstUser || i === tool || i === user || !eligible(m)),
    { ...anchor, parts: [text] },
    ...messages.slice(end + 1),
  ];
}

export function freezePrefix(messages: Messages, previousEnd?: string) {
  const lines: string[] = [];
  let size = 0;
  let freshBytes = 0;
  let end = 0;
  let uptoMessageId: string | undefined;
  const { firstUser, tool, user, tail } = protectedMessages(messages);
  for (const [i, m] of messages.entries()) {
    if (i >= tail) break;
    if (!eligible(m)) continue;
    const parts: unknown[] = [];
    for (const p of m.parts) {
      if (p.type === 'text') parts.push({ text: p.text });
      if (p.type === 'tool' && p.state.status === 'completed')
        parts.push({ partId: p.id, tool: p.tool, input: p.state.input, output: p.state.output });
    }
    const line = JSON.stringify({ role: m.info.role, messageId: m.info.id, parts });
    const length = new TextEncoder().encode(line).length + 1;
    // 首条任务指令永久保留；特大的首条消息不占用整个 Worker 的源文本预算。
    if (i === firstUser && length > MAX_SOURCE_BYTES) continue;
    if (size + length > MAX_SOURCE_BYTES) break;
    lines.push(line);
    size += length;
    if (m.info.id !== previousEnd && i !== firstUser && i !== user && i !== tool) freshBytes += length;
    if (m.info.role === 'assistant' && i !== tool && freshBytes >= MIN_SOURCE_BYTES) {
      uptoMessageId = m.info.id;
      end = lines.length;
    }
  }
  return uptoMessageId && uptoMessageId !== previousEnd
    ? { uptoMessageId, source: lines.slice(0, end).join('\n') }
    : undefined;
}

export function projectWindow(
  messages: Messages,
  excessBytes: number,
  recallTool: string | undefined,
  summary?: Summary,
) {
  // 摘要也可能包含回查坐标，仅在通道可用时投影。
  const candidate = recallTool && excessBytes > 0 && summary ? applySummary(messages, summary) : messages;
  const saved = candidate === messages ? 0 : historySize(messages).text - historySize(candidate).text;
  const base = saved > 0 ? candidate : messages;
  const projected = projectHistory(base, recallTool, excessBytes - Math.max(0, saved));
  const receipt = projectionReceipt(messages, base, projected, base === messages ? undefined : summary);
  return { projected, receipt, summarySource: base };
}

export {
  bytes,
  calibrate,
  DEFAULT_BYTES_PER_TOKEN,
  excessHistoryBytes,
  historyBytes,
  historySize,
  modelInputBudget,
  type Sample,
  SOFT_BUDGET_RATIO,
  SUMMARY_LABEL,
} from './budget.ts';

export { activeWindow, hasModelContent, MESSAGE_ABORTED_ERROR, type Messages } from './messages.ts';

function projectionReceipt(
  messages: Messages,
  base: Messages,
  candidate: Messages,
  summary?: Summary,
): ProjectionReceipt {
  const ids = new Set(candidate.map((m) => m.info.id));
  const sent = candidate.filter(hasModelContent).map((m) => m.info.id);
  const anchor = summary?.uptoMessageId ?? null;
  const latestTool = messages.findLast((m) => m.parts.some((p) => p.type === 'tool'))?.info.id;
  return {
    sent,
    folded: candidate.flatMap((m, i) => m.parts.filter((p, j) => p !== base[i]?.parts[j]).map((p) => p.id)),
    summarized: messages.filter((m) => !ids.has(m.info.id)).map((m) => m.info.id),
    anchor,
    summaryText: anchor ? (summary?.summaryText ?? null) : null,
    protected: messages
      .filter((m) => m.info.role === 'user' || m.info.id === latestTool || !eligible(m))
      .map((m) => m.info.id),
  };
}
