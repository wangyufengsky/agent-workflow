import type { AttemptDTO, AttemptSummaryDTO, TranscriptEntry, TranscriptPage } from '@aw/shared';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '../../api/query-keys.ts';
import { refreshAttempts, transcriptEntries, updateAttempt } from './attempt.queries.ts';

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

const attempt = (status: 'running' | 'succeeded') => ({ id: 'a1', status }) as unknown as AttemptDTO;

describe('attempt.updated 更新尝试缓存', () => {
  it('首次读取还在进行时到达的结束事件不会被那次（更早的）读取结果覆盖', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let answerFirstRead: (a: AttemptDTO) => void = () => {};
    let reads = 0;
    const observer = new QueryObserver(qc, {
      queryKey: queryKeys.attempt('a1'),
      // The first read is answered late, with the state from before the event; later reads see the current state.
      queryFn: () =>
        ++reads === 1
          ? new Promise<AttemptDTO>((resolve) => {
              answerFirstRead = resolve;
            })
          : Promise.resolve(attempt('succeeded')),
    });
    const unsubscribe = observer.subscribe(() => {});
    const updated = updateAttempt(qc, attempt('succeeded') as unknown as AttemptSummaryDTO);
    answerFirstRead(attempt('running'));
    await updated;
    expect(qc.getQueryData<AttemptDTO>(queryKeys.attempt('a1'))?.status).toBe('succeeded');
    unsubscribe();
  });
});

describe('离线环境切换后刷新尝试（D181）', () => {
  it('已打开的尝试重新读取（费用随设置出现或消失），它的会话流不重读', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const reads = { attempt: 0, transcript: 0 };
    const watch = (queryKey: readonly unknown[], counter: keyof typeof reads) =>
      new QueryObserver(qc, {
        queryKey,
        queryFn: () => {
          reads[counter] += 1;
          return {};
        },
      }).subscribe(() => {});
    watch(queryKeys.attempt('a1'), 'attempt');
    watch(queryKeys.transcript('a1'), 'transcript');
    await qc.refetchQueries();
    const before = { ...reads };

    await refreshAttempts(qc);
    expect(reads).toEqual({ attempt: before.attempt + 1, transcript: before.transcript });
  });
});
