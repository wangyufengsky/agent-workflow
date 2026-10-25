import {
  API_PREFIX,
  type AttemptDTO,
  type AttemptSummaryDTO,
  abortAttemptOp,
  getAttemptOp,
  mergePiece,
  startDebugAttemptOp,
  type TranscriptEntry,
  type TranscriptPage,
  transcriptPageSchema,
} from '@aw/shared';
import {
  infiniteQueryOptions,
  type QueryClient,
  type QueryKey,
  queryOptions,
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { callOperation, getJson } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';

export const attemptQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.attempt(id), queryFn: () => callOperation(getAttemptOp, { id }) });

/** A message stream read page by page (10 §3): an attempt's or an assistant conversation's. */
export type TranscriptSource = { key: QueryKey; liveKey: QueryKey; url: string };

export const attemptTranscript = (id: string): TranscriptSource => ({
  key: queryKeys.transcript(id),
  liveKey: queryKeys.transcriptLive(id),
  url: `${API_PREFIX}/attempts/${encodeURIComponent(id)}/transcript`,
});

/** The stream page by page; the view reads on in the background while `hasMore`. */
const transcriptQuery = (source: TranscriptSource) =>
  infiniteQueryOptions({
    queryKey: source.key,
    queryFn: ({ pageParam }) => getJson(`${source.url}?afterSeq=${pageParam}`, transcriptPageSchema),
    initialPageParam: 0,
    getNextPageParam: (last: TranscriptPage) => (last.hasMore ? last.lastSeq : undefined),
  });

/**
 * Entries pushed over SSE (`attempt.transcript`, `assistant.transcript`) since the stream was opened, kept apart from
 * the pages: a page read just before a line was appended misses it, and the line's event may arrive before that page
 * does. Pages and live lines together hold every line exactly once or twice, never zero times.
 */
const liveTranscriptQuery = (source: TranscriptSource) =>
  queryOptions<TranscriptEntry[]>({ queryKey: source.liveKey, queryFn: skipToken });

/**
 * Display order of pages followed by live lines (10 §3): pages cover lines 1…n without gaps, so only live lines after
 * the last page count, each once and in seq order. A streaming part keeps the position where it first appeared and
 * its lines merge into its text as they come (D104), whichever source brought them.
 */
export function transcriptEntries(
  pages: readonly TranscriptPage[],
  live: readonly TranscriptEntry[],
): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const indexOfPart = new Map<string, number>();
  const add = (entry: TranscriptEntry) => {
    if (!('partId' in entry)) {
      entries.push(entry);
      return;
    }
    const at = indexOfPart.get(entry.partId);
    const before = at === undefined ? undefined : entries[at];
    if (at === undefined || before === undefined || !('partId' in before)) {
      indexOfPart.set(entry.partId, entries.length);
      entries.push(entry);
      return;
    }
    entries[at] = { ...entry, data: mergePiece(before.data, entry.data) };
  };
  for (const page of pages) for (const entry of page.entries) add(entry);
  const covered = pages.at(-1)?.lastSeq ?? 0;
  const seen = new Set<number>();
  for (const entry of [...live].sort((a, b) => a.seq - b.seq)) {
    if (entry.seq <= covered || seen.has(entry.seq)) continue;
    seen.add(entry.seq);
    add(entry);
  }
  return entries;
}

/** SSE: lines of a stream someone has open are kept until its pages are read again. */
export function appendTranscript(qc: QueryClient, source: TranscriptSource, entries: readonly TranscriptEntry[]): void {
  if (qc.getQueryCache().find({ queryKey: source.key, exact: true }) === undefined) return;
  qc.setQueryData<TranscriptEntry[]>(source.liveKey, (old = []) => [...old, ...entries]);
}

/** One stream: the first page as soon as it arrives, the rest read on in the background, live lines after. */
export function useTranscript(source: TranscriptSource) {
  const pages = useInfiniteQuery(transcriptQuery(source));
  const live = useQuery(liveTranscriptQuery(source));
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = pages;
  // After a failed page the view offers a retry instead of reading on by itself.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  const entries = useMemo(
    () => (pages.data === undefined ? [] : transcriptEntries(pages.data.pages, live.data ?? [])),
    [pages.data, live.data],
  );
  return { pages, entries };
}

/**
 * SSE `attempt.updated`: the loaded attempt shows the summary at once, then is read again. A read already under way
 * started before the event, so its answer would undo it: it is cancelled first, as for a task (`updateTask`).
 */
export async function updateAttempt(qc: QueryClient, summary: AttemptSummaryDTO): Promise<void> {
  const key = queryKeys.attempt(summary.id);
  // Cancelled first: cancelling restores the state from before the read, which would undo the update.
  await qc.cancelQueries({ queryKey: key, exact: true });
  qc.setQueryData<AttemptDTO>(key, (old) => (old === undefined ? old : { ...old, ...summary }));
  await qc.invalidateQueries({ queryKey: key, exact: true });
}

/** Cached attempts are read again, their message streams are not: whether they carry a cost follows a setting (D181). */
export const refreshAttempts = (qc: QueryClient) =>
  qc.invalidateQueries({ queryKey: queryKeys.attemptsAll, predicate: ({ queryKey }) => queryKey.length === 2 });

export function useAbortAttempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => callOperation(abortAttemptOp, { id }),
    onSuccess: (attempt) => queryClient.setQueryData(queryKeys.attempt(attempt.id), attempt),
  });
}

export function useStartDebugAttempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { directory: string; requirement: string; model?: string }) =>
      callOperation(startDebugAttemptOp, input),
    onSuccess: (attempt) => queryClient.setQueryData(queryKeys.attempt(attempt.id), attempt),
  });
}
