import type { TranscriptEntry } from '@aw/shared';
import { TranscriptEntryKind } from '@aw/shared';
import { memo } from 'react';
import { ErrorState } from '../../components/error-state.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { ATTEMPT_COPY as C, TRANSCRIPT_SYSTEM_LABEL } from '../../copy/attempts.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { attemptTranscript, useTranscript } from './attempt.queries.ts';
import styles from './transcript.module.css';

const pretty = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));

/** Memoised: a live stream re-renders on every line, and Markdown is the costly part (M6-02). */
const Entry = memo(function Entry({ entry }: { entry: TranscriptEntry }) {
  switch (entry.kind) {
    case TranscriptEntryKind.UserMessage:
      return (
        <details className={styles.entry}>
          <summary className={styles.meta}>{C.userMessage}</summary>
          <pre className={styles.block}>{entry.data.text}</pre>
        </details>
      );
    case TranscriptEntryKind.Text:
      return <Markdown source={entry.data.text} />;
    case TranscriptEntryKind.Reasoning:
      return (
        <details className={styles.entry}>
          <summary className={styles.meta}>{C.reasoning}</summary>
          <p className={styles.reasoning}>{entry.data.text}</p>
        </details>
      );
    case TranscriptEntryKind.ToolCall:
      return (
        <details className={styles.entry}>
          <summary className={`${styles.meta} mono`}>{C.toolCall(entry.data.tool)}</summary>
          <pre className={styles.block}>{pretty(entry.data.input)}</pre>
        </details>
      );
    case TranscriptEntryKind.ToolResult: {
      const failed = entry.data.status === 'error';
      return (
        <details className={styles.entry}>
          <summary className={`${styles.meta} mono ${failed ? styles.error : ''}`}>
            {failed ? C.toolFailed(entry.data.tool) : C.toolResult(entry.data.tool)}
          </summary>
          <pre className={styles.block}>{failed ? entry.data.error : entry.data.output}</pre>
        </details>
      );
    }
    case TranscriptEntryKind.Permission:
      return <p className={styles.system}>{C.permission(entry.data.permission, entry.data.patterns.join(' '))}</p>;
    case TranscriptEntryKind.System:
      return (
        <p className={styles.system}>
          {TRANSCRIPT_SYSTEM_LABEL[entry.data.event]}
          {entry.data.detail === undefined ? null : ` · ${entry.data.detail}`}
        </p>
      );
    case TranscriptEntryKind.Error:
      return (
        <p className={`${styles.system} ${styles.error} mono`}>
          {entry.data.code} · {entry.data.message}
        </p>
      );
    case TranscriptEntryKind.Confirmation:
    case TranscriptEntryKind.Attachment:
      // Assistant conversations only (10 §3).
      return null;
  }
});

/** Live session stream of one attempt (10 §3): shown from its first page on, then extended by `attempt.transcript`. */
export function TranscriptView({ attemptId }: { attemptId: string }) {
  const { pages, entries } = useTranscript(attemptTranscript(attemptId));
  if (pages.data === undefined) {
    if (pages.isError) return <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />;
    return <p className="hint">{COMMON_COPY.loading}</p>;
  }
  if (entries.length === 0) return <p className="hint">{C.transcriptEmpty}</p>;
  return (
    <div className={styles.list} data-testid="transcript">
      {entries.map((entry) => (
        // A streaming part keeps its first position and key while its text grows.
        <Entry key={'partId' in entry ? entry.partId : entry.seq} entry={entry} />
      ))}
      {pages.isFetchNextPageError ? (
        <ErrorState error={pages.error} onRetry={() => void pages.fetchNextPage()} />
      ) : (
        pages.hasNextPage && <p className="hint">{COMMON_COPY.loading}</p>
      )}
    </div>
  );
}
