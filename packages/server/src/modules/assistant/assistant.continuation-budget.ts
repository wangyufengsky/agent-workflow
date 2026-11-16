import { ASSISTANT_CONTINUATION_MAX_CHARS } from '@aw/shared';
import type { OpencodeClient } from '../opencode/index.ts';
import { CONTINUATION_RECENT_HEADING } from './assistant.continuation-context.ts';

const REPLY_RESERVE_TOKENS = 4096;
const UNKNOWN_CONTEXT_LIMIT = 16_384;

/** Metadata can be unavailable for a provider; use the fixed conservative limit in that case. */
export async function continuationBudget(
  opencode: OpencodeClient,
  model: string | null,
  system: string,
  userText: string,
): Promise<number> {
  const models = await opencode.listModels();
  const key = model ?? models.defaultModel;
  const selected = models.available.find((m) => `${m.providerId}/${m.modelId}` === key);
  const limit = selected?.contextLimit ?? UNKNOWN_CONTEXT_LIMIT;
  // 按字符估算混合语言输入，为系统上下文、当前输入及回复保留空间。
  return Math.max(
    0,
    Math.min(ASSISTANT_CONTINUATION_MAX_CHARS, limit - REPLY_RESERVE_TOKENS - system.length - userText.length),
  );
}

/** Keep whole quoted lines, prioritising recent history and preserving the historical-data warning. */
export function fitContinuation(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const [earlier = '', recent = ''] = text.split(CONTINUATION_RECENT_HEADING);
  const [intro = '', ...facts] = earlier.split('\n');
  if (intro.length + CONTINUATION_RECENT_HEADING.length > budget) return '';
  let remaining = budget - intro.length - CONTINUATION_RECENT_HEADING.length;
  const keepRecent: string[] = [];
  for (const line of recent.split('\n').toReversed()) {
    if (line.length + 1 <= remaining) {
      keepRecent.unshift(line);
      remaining -= line.length + 1;
    }
  }
  const keepFacts: string[] = [];
  for (const line of facts) {
    if (line.length + 1 <= remaining) {
      keepFacts.push(line);
      remaining -= line.length + 1;
    }
  }
  return `${intro}${keepFacts.length ? `\n${keepFacts.join('\n')}` : ''}${CONTINUATION_RECENT_HEADING}${keepRecent.join('\n')}`;
}
