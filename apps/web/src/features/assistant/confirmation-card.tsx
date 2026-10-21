import { type AssistantConfirmationDTO, AssistantConfirmationStatus, OperationRisk } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { CONFIRMATION_COPY as C } from '../../copy/assistant.ts';
import { ERROR_COPY } from '../../copy/errors.ts';
import { operationTitle } from '../../copy/operations.ts';
import { taskDiffQuery } from '../tasks/tasks.queries.ts';
import styles from './assistant.module.css';
import { useCancelCall, useConfirmCall } from './assistant.queries.ts';

const shown = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));

/** Merging shows what would be merged (15 §4). */
function DeliveryImpact({ taskId }: { taskId: string }) {
  const diff = useQuery(taskDiffQuery(taskId)).data;
  if (diff === undefined) return null;
  // Binary files have no line counts.
  const sum = (key: 'additions' | 'deletions') => diff.files.reduce((n, f) => n + (f[key] ?? 0), 0);
  return <p className="hint">{C.diffStat(diff.files.length, sum('additions'), sum('deletions'))}</p>;
}

function Outcome({ confirmation }: { confirmation: AssistantConfirmationDTO }) {
  const { status, result } = confirmation;
  if (status === AssistantConfirmationStatus.Cancelled) return <p className="hint">{C.status.cancelled}</p>;
  if (result === null) return <p className="hint">{C.running}</p>;
  if (result.ok) return <p className="hint">{C.done}</p>;
  return (
    <p className={`${styles.failed} hint`}>
      {C.failed} · {ERROR_COPY[result.error.code]}
    </p>
  );
}

/** A write or critical call of the assistant waiting for the user (15 §4): what it does, with which input. */
export function ConfirmationCard({ confirmation }: { confirmation: AssistantConfirmationDTO }) {
  const confirm = useConfirmCall();
  const cancel = useCancelCall();
  const pending = confirmation.status === AssistantConfirmationStatus.Pending;
  const title = operationTitle(confirmation.title);
  const busy = confirm.isPending || cancel.isPending;
  const taskId = confirmation.input.id;
  return (
    <section
      className={`${styles.card} ${pending ? styles.cardWait : ''}`}
      aria-label={`${C.title}：${title}`}
      data-testid="confirmation-card"
    >
      <div className={styles.cardTitle}>
        <Icon name={confirmation.risk === OperationRisk.Critical ? 'alert' : 'info'} />
        <span className="grow">{title}</span>
        <span className="hint">{C.status[confirmation.status]}</span>
      </div>
      <dl className={styles.params} aria-label={C.input}>
        {Object.entries(confirmation.input).map(([key, value]) => (
          <div key={key} className={styles.param}>
            <dt>{key}</dt>
            <dd>{shown(value)}</dd>
          </div>
        ))}
      </dl>
      {pending && confirmation.operationId === 'tasks.deliver' && typeof taskId === 'string' && (
        <DeliveryImpact taskId={taskId} />
      )}
      {pending ? (
        <>
          <p className="hint">{C.impact[confirmation.risk]}</p>
          <div className={styles.actions}>
            <Button
              variant="primary"
              size="sm"
              pending={confirm.isPending && confirm.variables?.alwaysAllow === false}
              disabled={busy}
              onClick={() => confirm.mutate({ id: confirmation.id, alwaysAllow: false })}
            >
              {C.confirm}
            </Button>
            {confirmation.risk === OperationRisk.Write && (
              <Button
                size="sm"
                pending={confirm.isPending && confirm.variables?.alwaysAllow === true}
                disabled={busy}
                onClick={() => confirm.mutate({ id: confirmation.id, alwaysAllow: true })}
              >
                {C.confirmAlways}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              pending={cancel.isPending}
              disabled={busy}
              onClick={() => cancel.mutate(confirmation.id)}
            >
              {C.cancel}
            </Button>
          </div>
        </>
      ) : (
        <Outcome confirmation={confirmation} />
      )}
      {confirm.isError && <ErrorState error={confirm.error} />}
      {cancel.isError && <ErrorState error={cancel.error} />}
    </section>
  );
}
