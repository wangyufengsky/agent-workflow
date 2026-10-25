import {
  type AssistantConfirmationDTO,
  AssistantConfirmationStatus,
  OPERATION_CONTRACTS,
  OperationRisk,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { CONFIRMATION_COPY as C } from '../../copy/assistant.ts';
import { ERROR_COPY } from '../../copy/errors.ts';
import { operationTitle } from '../../copy/operations.ts';
import { GitInitSummary } from '../projects/git-init-summary.tsx';
import { gitInitPreviewQuery } from '../projects/projects.queries.ts';
import { taskDiffQuery } from '../tasks/tasks.queries.ts';
import { useCancelCall, useConfirmCall } from './assistant.queries.ts';
import styles from './cards.module.css';
import { InputSummary } from './input-summary.tsx';

/** Merging shows what would be merged (15 §4). */
function DeliveryImpact({ taskId }: { taskId: string }) {
  const diff = useQuery(taskDiffQuery(taskId)).data;
  if (diff === undefined) return null;
  // Binary files have no line counts.
  const sum = (key: 'additions' | 'deletions') => diff.files.reduce((n, f) => n + (f[key] ?? 0), 0);
  return <p className={styles.note}>{C.diffStat(diff.files.length, sum('additions'), sum('deletions'))}</p>;
}

function Outcome({ confirmation }: { confirmation: AssistantConfirmationDTO }) {
  const { status, result } = confirmation;
  if (status === AssistantConfirmationStatus.Cancelled) return <p className={styles.outcome}>{C.status.cancelled}</p>;
  if (result === null) return <p className={`${styles.outcome} shimmer`}>{C.running}</p>;
  if (result.ok) {
    return (
      <p className={styles.outcome} data-tone="ok">
        <Icon name="check" size="sm" />
        {C.done}
      </p>
    );
  }
  return (
    <p className={styles.outcome} data-tone="danger">
      <Icon name="alert" size="sm" />
      {C.failed} · {ERROR_COPY[result.error.code]}
    </p>
  );
}

function contractOf(operationId: string) {
  const contract = OPERATION_CONTRACTS.find((c) => c.id === operationId);
  // Confirmations are only created for registered operations.
  if (contract === undefined) throw new Error(`Unknown operation ${operationId}`);
  return contract;
}

/** A write or critical call of the assistant waiting for the user (15 §4): what it does, to what, in words. */
export function ConfirmationCard({ confirmation }: { confirmation: AssistantConfirmationDTO }) {
  const confirm = useConfirmCall();
  const cancel = useCancelCall();
  const pending = confirmation.status === AssistantConfirmationStatus.Pending;
  const critical = confirmation.risk === OperationRisk.Critical;
  const title = operationTitle(confirmation.title);
  const busy = confirm.isPending || cancel.isPending;
  const taskId = confirmation.input.id;
  const repoPath = confirmation.input.repoPath;
  const gitInitPath =
    confirmation.operationId === 'projects.initGit' && typeof repoPath === 'string' ? repoPath : undefined;
  // Putting a directory under Git commits every file not ignored: as in the add-project form, it is confirmed only
  // once what the first commit takes is shown (D153).
  const gitInit = useQuery({
    ...gitInitPreviewQuery(gitInitPath ?? ''),
    enabled: pending && gitInitPath !== undefined,
  });
  const awaitsPreview = gitInitPath !== undefined && !gitInit.isSuccess;
  return (
    <section
      className={styles.card}
      data-tone={pending ? (critical ? 'critical' : 'wait') : undefined}
      aria-label={`${C.title}：${title}`}
      data-testid="confirmation-card"
    >
      <header className={styles.cardHead}>
        <span className={styles.tile} data-tone={critical ? 'danger' : 'accent'} aria-hidden="true">
          <Icon name={critical ? 'alert' : 'edit'} size="sm" />
        </span>
        <span className={styles.cardHeading}>
          <span className={styles.eyebrow}>{C.title}</span>
          <span className={styles.cardTitle}>{title}</span>
        </span>
        <span className={styles.chip} data-status={confirmation.status}>
          {C.status[confirmation.status]}
        </span>
      </header>
      <InputSummary operation={contractOf(confirmation.operationId)} input={confirmation.input} />
      {pending && confirmation.operationId === 'tasks.deliver' && typeof taskId === 'string' && (
        <DeliveryImpact taskId={taskId} />
      )}
      {pending &&
        gitInitPath !== undefined &&
        (gitInit.isError ? (
          <ErrorState error={gitInit.error} onRetry={() => void gitInit.refetch()} />
        ) : (
          gitInit.data !== undefined && <GitInitSummary preview={gitInit.data} />
        ))}
      {pending ? (
        <>
          <p className={styles.note}>{C.impact[confirmation.risk]}</p>
          <div className={styles.actions}>
            <Button
              variant="primary"
              size="sm"
              pending={confirm.isPending && confirm.variables?.alwaysAllow === false}
              disabled={busy || awaitsPreview}
              onClick={() => confirm.mutate({ id: confirmation.id, alwaysAllow: false })}
            >
              {C.confirm}
            </Button>
            {confirmation.risk === OperationRisk.Write && (
              <Button
                size="sm"
                pending={confirm.isPending && confirm.variables?.alwaysAllow === true}
                disabled={busy || awaitsPreview}
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
