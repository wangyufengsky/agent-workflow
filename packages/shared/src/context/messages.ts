import type { Message as HookMessage, Part as HookPart } from '@opencode-ai/sdk';
import type { Message, Part as MessagePart } from '@opencode-ai/sdk/v2';
export type Messages = Array<{ info: Message | HookMessage; parts: (MessagePart | HookPart)[] }>;

/** V1 从最新的已完成摘要找到父 compaction 标记；保留尾段时，原生摘要排在尾段之前。 */
export function activeWindow(history: Messages) {
  const completed = new Set<string>();
  let start = 0,
    retain: string | undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (!m) continue;
    if (retain) {
      if (m.info.id === retain) {
        start = i;
        break;
      }
      continue;
    }
    if (m.info.role === 'assistant' && m.info.summary && m.info.finish && !m.info.error) completed.add(m.info.parentID);
    if (m.info.role !== 'user' || !completed.has(m.info.id)) continue;
    const marker = m.parts.find((p) => p.type === 'compaction');
    if (!marker) continue;
    retain = 'tail_start_id' in marker ? marker.tail_start_id : undefined;
    if (!retain || retain === m.info.id) {
      start = i;
      break;
    }
  }
  const window = history.slice(start);
  const retained = (m: Messages[number]) =>
    m.parts.find((p) => p.type === 'compaction' && 'tail_start_id' in p && p.tail_start_id !== undefined);
  const markerIndex = window.findLastIndex((m) => m.info.role === 'user' && !!retained(m));
  const marker = window[markerIndex];
  if (!marker) return window;
  const part = retained(marker);
  const tail = part && 'tail_start_id' in part ? window.findIndex((m) => m.info.id === part.tail_start_id) : -1;
  const end = window.findIndex(
    (m, j) => j > markerIndex && m.info.role === 'assistant' && m.info.summary && m.info.parentID === marker.info.id,
  );
  return tail >= 0 && tail < markerIndex && end > markerIndex
    ? [...window.slice(markerIndex, end + 1), ...window.slice(tail, markerIndex), ...window.slice(end + 1)]
    : window;
}

export const MESSAGE_ABORTED_ERROR = 'MessageAbortedError';
/** V1 在 toModelMessages 中跳过纯结构消息、普通错误回复和被忽略的用户输入。 */
export function hasModelContent({ info, parts }: Messages[number]) {
  if (info.role === 'user')
    return parts.some(
      (p) =>
        (p.type === 'text' && !p.ignored && p.text !== '') ||
        p.type === 'compaction' ||
        p.type === 'subtask' ||
        (p.type === 'file' && p.mime !== 'text/plain' && p.mime !== 'application/x-directory'),
    );
  if (
    info.error &&
    (info.error.name !== MESSAGE_ABORTED_ERROR || !parts.some((p) => p.type !== 'step-start' && p.type !== 'reasoning'))
  )
    return false;
  return parts.some((p) => p.type === 'tool' || p.type === 'text' || p.type === 'reasoning');
}
