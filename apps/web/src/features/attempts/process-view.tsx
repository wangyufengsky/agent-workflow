import { McpToolName } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { memo, useMemo } from 'react';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { PROCESS_COPY as C, TRANSCRIPT_SYSTEM_LABEL, toolActionLabel } from '../../copy/attempts.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { ERROR_COPY } from '../../copy/errors.ts';
import { attemptQuery, attemptTranscript, useTranscript } from './attempt.queries.ts';
import { type ProcessLine, processLines } from './process-lines.ts';

import styles from './transcript.module.css';

const isProgress = (line: Extract<ProcessLine, { kind: 'action' }>, progress: string) =>
  line.action.kind === 'app' && line.action.name === McpToolName.ReportProgress && line.action.detail === progress;

const Line = memo(function Line({ line }: { line: ProcessLine }) {
  switch (line.kind) {
    case 'text':
      return <Markdown source={line.text} />;
    case 'action':
      return (
        <p className={styles.action} data-state={line.state}>
          <span className={styles.mark} role="img" aria-label={C.state[line.state]}>
            {line.state === 'running' ? (
              <span className="spin" />
            ) : (
              <Icon name={line.state === 'ok' ? 'check' : 'x'} size="sm" />
            )}
          </span>
          <span className="mono ellipsis">{toolActionLabel(line.action)}</span>
        </p>
      );
    case 'permission':
      return <p className={styles.system}>{C.permission(line.permission, line.patterns.join(' '))}</p>;
    case 'system':
      return <p className={styles.system}>{TRANSCRIPT_SYSTEM_LABEL[line.event]}</p>;
    case 'error':
      return <p className={`${styles.system} ${styles.error}`}>{ERROR_COPY[line.error.code]}</p>;
  }
});

/**
 * An attempt's session in the simple view (14 §3.4「过程」): the AI's text and one line per tool call, live while it
 * runs; `progress` is its latest `report_progress` line.
 */
export function ProcessView({ attemptId, progress }: { attemptId: string; progress: string | null }) {
  const attempt = useQuery(attemptQuery(attemptId));
  const { pages, entries } = useTranscript(attemptTranscript(attemptId));
  const directory = attempt.data?.directory;
  const lines = useMemo(() => (directory === undefined ? [] : processLines(entries, directory)), [entries, directory]);
  // The banner above already shows the latest progress line.
  const shown = progress === null ? lines : lines.filter((l) => !(l.kind === 'action' && isProgress(l, progress)));
  if (attempt.isError) return <ErrorState error={attempt.error} onRetry={() => void attempt.refetch()} />;
  if (pages.isError && pages.data === undefined)
    return <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />;
  if (attempt.data === undefined || pages.data === undefined) return <p className="hint">{COMMON_COPY.loading}</p>;
  return (
    <div className={styles.list} data-testid="process">
      {progress !== null && (
        <p className={styles.now}>
          <span className="spin" aria-hidden="true" />
          {C.now}：{progress}
        </p>
      )}
      {shown.length === 0 && progress === null && <p className="hint">{C.empty}</p>}
      {shown.map((line) => (
        <Line key={line.key} line={line} />
      ))}
      {pages.hasNextPage && <p className="hint">{COMMON_COPY.loading}</p>}
    </div>
  );
}
