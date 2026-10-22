import { NodeStatus, type TaskDetailDTO, TaskFailedPhase } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { Panel } from '../../components/panel.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { TASK_COPY as C } from '../../copy/tasks.ts';
import { CheckFailureActions } from '../tasks/check-failure-actions.tsx';
import { failedNodeKeyOf, failureText, unrunnableDetails } from '../tasks/failure-text.ts';
import { nodeQuery, useRetryTask } from '../tasks/tasks.queries.ts';
import { type LastFailure, lastFailure, outputTail } from './last-failure.ts';
import { NodeTab, ReviewOutcome } from './node-drawer.tsx';
import styles from './task-page.module.css';

/** Lines of a failing command's output shown before「展开全部输出」. */
const OUTPUT_TAIL_LINES = 15;

/**
 * Failed task (14 §3.3): which phase or step and why in the user's words; for a step, what its last attempt ran into
 * (D118). Retry, optionally with a note for the AI, which checks again when the check command could not run; the step's
 * process; the ways out of a failing check command (D116). The only place the task page shows the failure: its inbox
 * item is left out of the side panel.
 */
export function FailurePanel({
  task,
  onOpenStep,
}: {
  task: TaskDetailDTO;
  onOpenStep: (nodeId: string, tab: NodeTab) => void;
}) {
  const retry = useRetryTask();
  const [noting, setNoting] = useState(false);
  const { failure, failedPhase } = task;
  const nodeKey = failure === null ? undefined : failedNodeKeyOf(failure);
  const step = task.nodes.find((n) => n.key === nodeKey);
  if (failure === null || failedPhase === null) return null;
  const unrunnable = unrunnableDetails(failure) !== undefined;
  const done = task.nodes.filter((n) => n.status === NodeStatus.Done).length;
  return (
    <Panel title={C.failedTitle}>
      <div className="col" data-testid="failure-panel">
        <p>
          <Markdown inline source={failureText(failedPhase, failure)} />
        </p>
        {step !== undefined && !unrunnable && <LastTry taskId={task.id} nodeId={step.id} />}
        {step !== undefined && done > 0 && <p className="hint">{C.keptSteps(done)}</p>}
        <div className={styles.actions}>
          <Button
            variant="primary"
            icon="refresh"
            pending={retry.isPending}
            onClick={() =>
              retry.mutate({ id: task.id }, { onSuccess: () => toast(unrunnable ? C.rechecked : C.retried) })
            }
          >
            {unrunnable ? C.recheck : C.retry}
          </Button>
          {failedPhase === TaskFailedPhase.Running && !unrunnable && (
            <Button onClick={() => setNoting(true)}>{C.retryWithNote}</Button>
          )}
          <CheckFailureActions taskId={task.id} error={failure} />
          {step !== undefined && (
            <Button variant="ghost" icon="chevRight" onClick={() => onOpenStep(step.id, NodeTab.Process)}>
              {C.viewStepProcess}
            </Button>
          )}
        </div>
        {retry.isError && <ErrorState error={retry.error} />}
        <details>
          <summary className="hint">{COMMON_COPY.errorDetails}</summary>
          <pre className={styles.output}>
            {failure.code} · {failure.message}
          </pre>
        </details>
      </div>
      {noting && <RetryNoteDialog taskId={task.id} onClose={() => setNoting(false)} />}
    </Panel>
  );
}

/** What the failed step's last attempt ran into, read from the step (D118). */
function LastTry({ taskId, nodeId }: { taskId: string; nodeId: string }) {
  const node = useQuery(nodeQuery(taskId, nodeId));
  if (node.data === undefined) return null;
  const last = lastFailure(node.data);
  return last === null ? null : <LastFailureView last={last} />;
}

function LastFailureView({ last }: { last: LastFailure }) {
  const [full, setFull] = useState(false);
  switch (last.kind) {
    case 'command': {
      const { check } = last;
      const { tail, cut } = outputTail(check.output, OUTPUT_TAIL_LINES);
      return (
        <div className="col" data-testid="last-failure">
          <Markdown inline source={C.lastCommand(check.command, check.exitCode, check.timedOut)} />
          <pre className={styles.output}>{full ? check.output : tail}</pre>
          {cut && (
            <span>
              <Button size="sm" variant="ghost" onClick={() => setFull(!full)}>
                {full ? C.tailOutput : C.fullOutput}
              </Button>
            </span>
          )}
        </div>
      );
    }
    case 'review':
      return (
        <div className="col" data-testid="last-failure">
          <span>{C.lastReview}</span>
          <ReviewOutcome check={last.check} />
        </div>
      );
    case 'attempt':
      return (
        <p className="hint" data-testid="last-failure">
          {C.lastAttempt(last.aborted, last.error?.code)}
        </p>
      );
  }
}

/** Retry with a note the failed steps' next attempt gets (D118). */
function RetryNoteDialog({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const [note, setNote] = useState('');
  const retry = useRetryTask();
  const send = () =>
    retry.mutate(
      { id: taskId, feedback: note.trim() },
      {
        onSuccess: () => {
          toast(C.retried);
          onClose();
        },
      },
    );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={C.retryNoteTitle}
      description={C.retryNoteBody}
      footer={
        <Button variant="primary" icon="refresh" pending={retry.isPending} disabled={note.trim() === ''} onClick={send}>
          {C.retry}
        </Button>
      }
    >
      <textarea
        className="textarea"
        rows={3}
        aria-label={C.retryNoteField}
        placeholder={C.retryNotePlaceholder}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {retry.isError && <ErrorState error={retry.error} />}
    </Dialog>
  );
}
