import { type TaskDetailDTO, TaskStatus, WorkflowDeliverable } from '@aw/shared';
import { useState } from 'react';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { Panel } from '../../components/panel.tsx';
import { toast } from '../../components/toast.tsx';
import { TASK_COPY as C } from '../../copy/tasks.ts';
import { useCancelTask } from '../tasks/tasks.queries.ts';
import styles from './task-page.module.css';

/** Result card (14 §3.5). Merging and pull requests arrive with delivery (M4); their buttons are placeholders. */
export function ResultCard({ task }: { task: TaskDetailDTO }) {
  const [discarding, setDiscarding] = useState(false);
  const cancel = useCancelTask();
  const { result } = task;
  if (result === null) return <p className="hint">{C.resultPending}</p>;
  const report = task.workflow.deliverable === WorkflowDeliverable.Report;
  const failedChecks = result.checks.filter((c) => !c.passed).length;
  const checks =
    result.checks.length === 0 ? C.noChecks : failedChecks === 0 ? C.checksPassed : C.checksFailed(failedChecks);
  const actionable = task.status === TaskStatus.Review;
  return (
    <Panel solid>
      <div className="col" data-testid="result-card">
        <p className={styles.headline}>
          <Icon name="check" />
          {C.resultHeadline(result.nodeSummaries.length, result.filesChanged, result.insertions, result.deletions)} ·{' '}
          {checks}
        </p>
        <h3 className="sec-t">{report ? C.report : C.summary}</h3>
        <Markdown source={result.summary} />
        {result.assumptions.length > 0 && (
          <>
            <h3 className="sec-t">{C.assumptions}</h3>
            <ul>
              {result.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </>
        )}
        {result.files.length > 0 && (
          <>
            <h3 className="sec-t">{C.changedFiles}</h3>
            <ul className={styles.files}>
              {result.files.map((f) => (
                <li key={f.path} className={styles.file}>
                  <span className="mono grow ellipsis">{f.path}</span>
                  <span className={styles.add}>+{f.additions ?? 0}</span>
                  <span className={styles.del}>−{f.deletions ?? 0}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {actionable && (
          <>
            <div className={styles.actions}>
              {report ? (
                <>
                  <Button variant="primary" disabled>
                    {C.complete}
                  </Button>
                  <Button disabled>{C.fixFromReport}</Button>
                </>
              ) : (
                <>
                  <Button variant="primary" icon="git" disabled>
                    {C.merge(task.git.baseBranch)}
                  </Button>
                  <Button disabled>{C.createPr}</Button>
                  <Button disabled>{C.revise}</Button>
                </>
              )}
              <Button variant="ghost" onClick={() => setDiscarding(true)}>
                {C.discard}
              </Button>
            </div>
            <span className="hint">{C.deliveryLater}</span>
          </>
        )}
      </div>
      <Dialog
        open={discarding}
        onOpenChange={setDiscarding}
        title={C.cancelTitle}
        footer={
          <Button
            variant="danger"
            pending={cancel.isPending}
            onClick={() => cancel.mutate(task.id, { onSuccess: () => toast(C.cancelled) })}
          >
            {C.discard}
          </Button>
        }
      >
        <p>{C.cancelBody}</p>
        {cancel.isError && <ErrorState error={cancel.error} />}
      </Dialog>
    </Panel>
  );
}
