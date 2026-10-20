import { AttemptStatus, STATUS_TONE } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Panel } from '../../components/panel.tsx';
import { StatusBadge } from '../../components/status-badge.tsx';
import { ATTEMPT_STATUS_LABEL, ATTEMPT_COPY as C } from '../../copy/attempts.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { attemptQuery, useAbortAttempt } from './attempt.queries.ts';
import { TranscriptView } from './transcript-view.tsx';

/** One attempt: status, progress, usage and its live transcript. */
export function AttemptView({ attemptId }: { attemptId: string }) {
  const attempt = useQuery(attemptQuery(attemptId));
  const abort = useAbortAttempt();
  if (attempt.isPending) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (attempt.isError) return <ErrorState error={attempt.error} onRetry={() => void attempt.refetch()} />;
  const a = attempt.data;
  return (
    <Panel
      title={C.title(a.kind, a.seq)}
      actions={
        <span className="row">
          <StatusBadge tone={STATUS_TONE.attempt[a.status]} label={ATTEMPT_STATUS_LABEL[a.status]} />
          {a.status === AttemptStatus.Running && (
            <Button size="sm" variant="danger" pending={abort.isPending} onClick={() => abort.mutate(a.id)}>
              {C.abort}
            </Button>
          )}
        </span>
      }
    >
      <dl className="kv">
        {a.progress !== null && (
          <>
            <dt>{C.progress}</dt>
            <dd>{a.progress}</dd>
          </>
        )}
        <dt>{C.model}</dt>
        <dd className="mono">{a.model ?? C.defaultModel}</dd>
        <dt>{C.nudges}</dt>
        <dd>{a.nudges}</dd>
        {a.tokensInput !== null && a.tokensOutput !== null && (
          <>
            <dt>{C.tokens}</dt>
            <dd>{C.tokenUsage(a.tokensInput, a.tokensOutput)}</dd>
          </>
        )}
        {a.cost !== null && (
          <>
            <dt>{C.cost}</dt>
            <dd>{C.costValue(a.cost)}</dd>
          </>
        )}
        <dt>{C.time}</dt>
        <dd>{C.timeRange(a.startedAt, a.endedAt)}</dd>
        {a.error !== null && (
          <>
            <dt>{C.error}</dt>
            <dd className="mono error-text">
              {a.error.code} · {a.error.message}
            </dd>
          </>
        )}
      </dl>
      {abort.isError && <ErrorState error={abort.error} />}
      <div className="divider" />
      <h3 className="sec-t">{C.transcript}</h3>
      <TranscriptView attemptId={a.id} />
    </Panel>
  );
}
