import { closeSync, openSync, readSync, statSync } from 'node:fs';
import {
  AppError,
  type AssistantHistoryPage,
  ErrorCode,
  type TranscriptEntry,
  TranscriptEntryKind,
  transcriptEntrySchema,
} from '@aw/shared';
import { mergeTranscriptParts } from '../attempts/index.ts';

const HISTORY_TURNS = 8;
const READ_BYTES = 64 * 1024;
const LF = 10;

/** 从最后一个换行符前面向前读，跨块时拼齐一整行再解码，游标始终落在记录的首字节。 */
function* reverseLines(fd: number, end: number) {
  let position = end - 1;
  let suffix: Buffer[] = [];
  while (position > 0) {
    const start = Math.max(0, position - READ_BYTES);
    const block = Buffer.allocUnsafe(position - start);
    const read = readSync(fd, block, 0, block.length, start);
    if (read !== block.length) throw new Error('Transcript changed while reading history');
    let right = block.length;
    while (right > 0) {
      const lf = block.lastIndexOf(LF, right - 1);
      if (lf < 0) break;
      const part = block.subarray(lf + 1, right);
      yield { offset: start + lf + 1, line: Buffer.concat([part, ...suffix.reverse()]).toString('utf8') };
      suffix = [];
      right = lf;
    }
    suffix.push(block.subarray(0, right));
    position = start;
  }
  yield { offset: 0, line: Buffer.concat(suffix.reverse()).toString('utf8') };
}

export function readAssistantHistory(file: string, before?: number): AssistantHistoryPage {
  const size = statSync(file, { throwIfNoEntry: false })?.size ?? 0;
  const end = before ?? size;
  if (end > size) throw new AppError(ErrorCode.ValidationFailed, 'Invalid history cursor');
  if (end === 0) return { entries: [], lastSeq: 0, before: null };
  const fd = openSync(file, 'r');
  try {
    if (before !== undefined) {
      const boundary = Buffer.alloc(1);
      readSync(fd, boundary, 0, 1, end - 1);
      if (boundary[0] !== LF) throw new AppError(ErrorCode.ValidationFailed, 'Invalid history cursor');
    }
    const entries: TranscriptEntry[] = [];
    let turns = 0;
    let offset = 0;
    for (const row of reverseLines(fd, end)) {
      const entry = transcriptEntrySchema.parse(JSON.parse(row.line));
      entries.push(entry);
      offset = row.offset;
      if (entry.kind === TranscriptEntryKind.UserMessage && ++turns === HISTORY_TURNS) break;
    }
    const lastSeq = entries[0]?.seq ?? 0;
    return { entries: mergeTranscriptParts(entries.reverse()), lastSeq, before: offset || null };
  } finally {
    closeSync(fd);
  }
}
