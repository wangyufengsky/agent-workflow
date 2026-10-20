import { ErrorCode, type TaskDetailDTO } from '@aw/shared';
import { z } from 'zod';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Panel } from '../../components/panel.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { ERROR_COPY } from '../../copy/errors.ts';
import { TASK_COPY as C } from '../../copy/tasks.ts';
import { useRetryTask } from '../tasks/tasks.queries.ts';
import styles from './task-page.module.css';

const exhaustedSchema = z.object({ nodeTitle: z.string(), feedback: z.string().nullable() });

/** Failed task (14 §3.3): which phase, why in the user's words, technical details folded; retry. */
export function FailurePanel({ task }: { task: TaskDetailDTO }) {
  const retry = useRetryTask();
  const { failure, failedPhase } = task;
  if (failure === null || failedPhase === null) return null;
  const exhausted =
    failure.code === ErrorCode.NodeAttemptsExhausted ? exhaustedSchema.parse(failure.details) : undefined;
  return (
    <Panel title={C.failedTitle}>
      <div className="col" data-testid="failure-panel">
        <p>
          {C.failedPhase[failedPhase]}：
          {exhausted === undefined ? ERROR_COPY[failure.code] : C.failedStep(exhausted.nodeTitle)}
        </p>
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
