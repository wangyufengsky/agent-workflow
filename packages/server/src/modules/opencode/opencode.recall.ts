import { AppError, ErrorCode, RECALL_PAGE_MAX_CHARS, type RecallInput, type RecallOutput } from '@aw/shared';
import type { OpencodeClient } from './opencode.client.ts';

export async function recallPage(
  opencode: OpencodeClient,
  sessionId: string,
  directory: string,
  { messageId, partId, offset, limit }: RecallInput,
  signal?: AbortSignal,
): Promise<RecallOutput> {
  const text = await opencode.readToolOutput({
    sessionId,
    directory,
    messageId,
    partId,
    ...(signal && { signal }),
  });
  if (text === undefined)
    throw new AppError(ErrorCode.NotFound, 'Completed text tool result not found in the current session');
  const chars = Array.from(text);
  const start = Math.min(offset, chars.length);
  const end = Math.min(start + Math.min(limit, RECALL_PAGE_MAX_CHARS), chars.length);
  return {
    content: chars.slice(start, end).join(''),
    offset: start,
    totalLength: chars.length,
    nextOffset: end < chars.length ? end : null,
  };
}
