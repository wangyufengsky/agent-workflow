import { AttemptStatus } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { ATTEMPT_COPY as C, STREAM_COPY } from '../../copy/attempts.ts';
import { ConversationStream } from '../stream/conversation-stream.tsx';
import { attemptQuery, useAbortAttempt } from './attempt.queries.ts';

/**
 * One attempt in the pro view (14 §3.4, 25 §3): its conversation stream with the model, usage and nudges in the
 * header, and an abort button while it runs.
 */
export function AttemptView({ attemptId }: { attemptId: string }) {
  const attempt = useQuery(attemptQuery(attemptId)).data;
  const abort = useAbortAttempt();
  if (attempt === undefined) return <ConversationStream attemptId={attemptId} title="" pro size="page" />;
  const tokens =
    attempt.tokensInput === null || attempt.tokensOutput === null
      ? null
      : C.tokenUsage(attempt.tokensInput, attempt.tokensOutput);
  return (
    <div className="col">
      <ConversationStream
        attemptId={attempt.id}
        title={STREAM_COPY.attemptTitle(attempt.kind, attempt.seq)}
        meta={STREAM_COPY.pro(attempt.model ?? C.defaultModel, tokens, attempt.nudges)}
        actions={
          attempt.status === AttemptStatus.Running && (
            <Button size="sm" variant="danger" pending={abort.isPending} onClick={() => abort.mutate(attempt.id)}>
              {C.abort}
            </Button>
          )
        }
        pro
        size="page"
      />
      {abort.isError && <ErrorState error={abort.error} />}
    </div>
  );
}
