import type { DeckDTO, DeckRunDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { formatDateTime } from '../../copy/common.ts';
import { PPT_COPY as C } from '../../copy/ppt.ts';
import { attemptQuery } from '../attempts/attempt.queries.ts';
import { AttemptView } from '../attempts/attempt-view.tsx';
import styles from './ppt.module.css';

function RunRecord({ run }: { run: DeckRunDTO }) {
  const attempt = useQuery(attemptQuery(run.attempt.id)).data;
  return (
    <details className={styles.record}>
      <summary>
        {C.runKind[run.kind]} · {formatDateTime(run.createdAt)} · {C.modelOf(run.model)}
        {run.instruction !== null && ` · ${run.instruction}`}
      </summary>
      {attempt !== undefined && <p className="hint">{C.usage(attempt.tokensInput, attempt.tokensOutput)}</p>}
      <AttemptView attemptId={run.attempt.id} />
    </details>
  );
}

/** Pro view (23 §2.4): every AI work of the PPT with its model, usage and session stream. */
export function AiRecord({ deck }: { deck: DeckDTO }) {
  return (
    <section className="col" aria-label={C.aiRecord}>
      <span className="label">{C.aiRecord}</span>
      {[...deck.runs].reverse().map((run) => (
        <RunRecord key={run.id} run={run} />
      ))}
    </section>
  );
}
