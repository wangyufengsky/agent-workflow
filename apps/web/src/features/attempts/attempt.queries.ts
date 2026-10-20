import {
  API_PREFIX,
  type AttemptDTO,
  type AttemptSummaryDTO,
  abortAttemptOp,
  getAttemptOp,
  startDebugAttemptOp,
  type TranscriptEntry,
  type TranscriptPage,
  transcriptPageSchema,
} from '@aw/shared';
import {
  infiniteQueryOptions,
  type QueryClient,
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

/** The stream page by page (10 §3); the view reads on in the background while `hasMore`. */
export const transcriptQuery = (id: string) =>
  infiniteQueryOptions({
    queryKey: queryKeys.transcript(id),
    queryFn: ({ pageParam }) =>
      getJson(
        `${API_PREFIX}/attempts/${encodeURIComponent(id)}/transcript?afterSeq=${pageParam}`,
        transcriptPageSchema,
      ),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.lastSeq : undefined),
  });

/**
 * Entries pushed over SSE (`attempt.transcript`) since the stream was opened, kept apart from the pages: a page read
 * just before a line was appended misses it, and the line's event may arrive before that page does. Pages and live
 * lines together hold every line exactly once or twice, never zero times.
 */
export const liveTranscriptQuery = (id: string) =>
  queryOptions<TranscriptEntry[]>({ queryKey: queryKeys.transcriptLive(id), queryFn: skipToken });

/**
 * Display order of pages followed by live lines: each line once (by seq); a streaming part keeps the position where
 * it first appeared and shows its latest text (10 §3). Pages cover lines 1…n without gaps, so a live line not in
 * them comes after all of them.
 */
export function transcriptEntries(
  pages: readonly TranscriptPage[],
  live: readonly TranscriptEntry[],
): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const indexOfPart = new Map<string, number>();
  const seen = new Set<number>();
  for (const entry of [...pages.flatMap((p) => p.entries), ...live]) {
    if (seen.has(entry.seq)) continue;
    seen.add(entry.seq);
    const partId = 'partId' in entry ? entry.partId : undefined;
    const at = partId === undefined ? undefined : indexOfPart.get(partId);
    if (at !== undefined) {
      entries[at] = entry;
      continue;
    }
    if (partId !== undefined) indexOfPart.set(partId, entries.length);
    entries.push(entry);
  }
  return entries;
}

/** SSE: lines of a stream someone has open are kept until its pages are read again. */
export function appendTranscript(qc: QueryClient, attemptId: string, entries: readonly TranscriptEntry[]): void {
  if (qc.getQueryCache().find({ queryKey: queryKeys.transcript(attemptId), exact: true }) === undefined) return;
  qc.setQueryData<TranscriptEntry[]>(queryKeys.transcriptLive(attemptId), (old = []) => [...old, ...entries]);
}

/** One attempt's stream: the first page as soon as it arrives, the rest read on in the background, live lines after. */
export function useTranscript(attemptId: string) {
  const pages = useInfiniteQuery(transcriptQuery(attemptId));
  const live = useQuery(liveTranscriptQuery(attemptId));
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

/** SSE: a summary update refreshes the loaded attempt without a request. */
export function updateAttempt(qc: QueryClient, summary: AttemptSummaryDTO): void {
  qc.setQueryData<AttemptDTO>(queryKeys.attempt(summary.id), (old) =>
    old === undefined ? old : { ...old, ...summary },
  );
}

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
