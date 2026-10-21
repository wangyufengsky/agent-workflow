import type { TaskDetailDTO } from '@aw/shared';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Panel } from '../../components/panel.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { TASK_COPY as C } from '../../copy/tasks.ts';
import { exhaustedDetails, failureText } from '../tasks/failure-text.ts';
import { useRetryTask } from '../tasks/tasks.queries.ts';
import styles from './task-page.module.css';

/**
 * Failed task (14 §3.3): which phase or step, why in the user's words, technical details folded; retry. The only place
 * the task page shows the failure: its inbox item is left out of the side panel.
 */
export function FailurePanel({ task }: { task: TaskDetailDTO }) {
  const retry = useRetryTask();
  const { failure, failedPhase } = task;
  if (failure === null || failedPhase === null) return null;
  const exhausted = exhaustedDetails(failure);
  return (
    <Panel title={C.failedTitle}>
      <div className="col" data-testid="failure-panel">
        <p>{failureText(failedPhase, failure)}</p>
        <details>
          <summary className="hint">{COMMON_COPY.errorDetails}</summary>
          <pre className={styles.output}>
            {failure.code} · {failure.message}
            {exhausted?.feedback === undefined || exhausted.feedback === null ? '' : `\n\n${exhausted.feedback}`}
          </pre>
        </details>
        <div className={styles.actions}>
          <Button
            variant="primary"
            icon="refresh"
            pending={retry.isPending}
            onClick={() => retry.mutate(task.id, { onSuccess: () => toast(C.retried) })}
          >
            {C.retry}
          </Button>
        </div>
        {retry.isError && <ErrorState error={retry.error} />}
      </div>
    </Panel>
  );
}
