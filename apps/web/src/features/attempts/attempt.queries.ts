import {
  API_PREFIX,
  type AttemptDTO,
  type AttemptSummaryDTO,
  abortAttemptOp,
  getAttemptOp,
  startDebugAttemptOp,
  type TranscriptEntry,
  transcriptPageSchema,
} from '@aw/shared';
import { type QueryClient, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { callOperation, getJson } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';

export const attemptQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.attempt(id), queryFn: () => callOperation(getAttemptOp, { id }) });

/** Entries in display order; `lastSeq` is the newest line already merged. */
export type Transcript = { entries: TranscriptEntry[]; lastSeq: number };

/** A streaming part replaces its earlier line in place (10 §3); other entries append. Lines already seen are skipped. */
export function mergeTranscript(current: Transcript, incoming: readonly TranscriptEntry[]): Transcript {
  const entries = [...current.entries];
  let { lastSeq } = current;
  for (const entry of incoming) {
    if (entry.seq <= lastSeq) continue;
    lastSeq = entry.seq;
    const partId = 'partId' in entry ? entry.partId : undefined;
    const at = partId === undefined ? -1 : entries.findIndex((e) => 'partId' in e && e.partId === partId);
    if (at === -1) entries.push(entry);
    else entries[at] = entry;
  }
  return { entries, lastSeq };
}

/** Reads every page written so far; `attempt.transcript` events extend it afterwards. */
export const transcriptQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.transcript(id),
    queryFn: async (): Promise<Transcript> => {
      let transcript: Transcript = { entries: [], lastSeq: 0 };
      for (;;) {
        const page = await getJson(
          `${API_PREFIX}/attempts/${encodeURIComponent(id)}/transcript?afterSeq=${transcript.lastSeq}`,
          transcriptPageSchema,
        );
        const before = transcript.lastSeq;
        transcript = { ...mergeTranscript(transcript, page.entries), lastSeq: page.lastSeq };
        if (page.done || page.lastSeq === before) return transcript;
      }
    },
  });

/** SSE: new lines extend a loaded transcript; while it is still loading, reload so nothing falls between. */
export function appendTranscript(
  qc: QueryClient,
  attemptId: string,
  entries: readonly TranscriptEntry[],
): Promise<void> {
  const key = queryKeys.transcript(attemptId);
  const current = qc.getQueryData<Transcript>(key);
  if (current === undefined) return qc.invalidateQueries({ queryKey: key });
  qc.setQueryData<Transcript>(key, mergeTranscript(current, entries));
  return Promise.resolve();
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
