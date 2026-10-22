import type { TranscriptEntry, TranscriptPage } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { transcriptEntries } from './attempt.queries.ts';

const text = (seq: number, partId: string, value: string, offset: number): TranscriptEntry => ({
  seq,
  ts: 0,
  kind: 'text',
  partId,
  data: { text: value, offset },
});
const call = (seq: number): TranscriptEntry => ({
  seq,
  ts: 0,
  kind: 'tool_call',
  data: { tool: 'bash', callId: `c${seq}`, input: {} },
});
const page = (entries: TranscriptEntry[], lastSeq: number, hasMore: boolean): TranscriptPage => ({
  entries,
  lastSeq,
  hasMore,
  done: false,
});
const shown = (entries: TranscriptEntry[]) => entries.map((e) => [e.seq, e.kind === 'text' ? e.data.text : e.kind]);

describe('会话流的显示顺序', () => {
  it('分页与实时推送重叠的行只算一次；流式片段留在首次出现的位置，按增量接成全文', () => {
    // Page 1 holds part p's lines up to seq 2 and a call; page 2 continues p; SSE repeated seq 4 and brought 5–6.
    const pages = [page([text(2, 'p', 'ab', 0), call(3)], 3, true), page([text(4, 'p', 'c', 2)], 4, false)];
    const live = [text(6, 'p', 'd', 3), text(4, 'p', 'c', 2), call(5)];
    expect(shown(transcriptEntries(pages, live))).toEqual([
      [6, 'abcd'],
      [3, 'tool_call'],
      [5, 'tool_call'],
    ]);
  });

  it('页面已经包含的行经实时推送再来时不会重复接上', () => {
    // The page was read after seq 3 was written and merged seq 2–3; SSE also brought both lines.
    const pages = [page([text(3, 'p', 'abc', 0)], 3, false)];
    const live = [text(2, 'p', 'ab', 0), text(3, 'p', 'c', 2)];
    expect(shown(transcriptEntries(pages, live))).toEqual([[3, 'abc']]);
  });

  it('D104 之前写的整段行替换已有文本', () => {
    const pages = [page([text(1, 'p', 'draft', 0), text(2, 'p', 'final text', 0)], 2, false)];
    expect(shown(transcriptEntries(pages, []))).toEqual([[2, 'final text']]);
  });
});
