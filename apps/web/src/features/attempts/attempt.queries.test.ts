import type { TranscriptEntry, TranscriptPage } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { transcriptEntries } from './attempt.queries.ts';

const text = (seq: number, partId: string, value: string): TranscriptEntry => ({
  seq,
  ts: 0,
  kind: 'text',
  partId,
  data: { text: value },
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

describe('会话流的显示顺序', () => {
  it('分页与实时推送重叠的行只出现一次；流式片段留在首次出现的位置并显示最新文本', () => {
    // Page 1 holds part p up to seq 2 and a call; page 2 continues p; SSE repeated seq 4 and brought 5–6.
    const pages = [page([text(2, 'p', 'ab'), call(3)], 3, true), page([text(4, 'p', 'abc')], 4, false)];
    const live = [text(4, 'p', 'abc'), call(5), text(6, 'p', 'abcd')];
    expect(transcriptEntries(pages, live).map((e) => [e.seq, e.kind === 'text' ? e.data.text : e.kind])).toEqual([
      [6, 'abcd'],
      [3, 'tool_call'],
      [5, 'tool_call'],
    ]);
  });

  it('页面已有某片段的较新一行时，经实时推送补来的较旧一行不会覆盖它', () => {
    // The page was read after seq 3 was written: the server keeps p's last line only. SSE also brought seq 2.
    const pages = [page([text(3, 'p', 'abc')], 3, false)];
    const live = [text(2, 'p', 'ab'), text(3, 'p', 'abc')];
    expect(transcriptEntries(pages, live).map((e) => [e.seq, e.kind === 'text' ? e.data.text : e.kind])).toEqual([
      [3, 'abc'],
    ]);
  });
});
