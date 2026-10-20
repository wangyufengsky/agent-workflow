import { AttemptKind, AttemptStatus, NodeStatus, type NodeSummaryDTO, type TaskDetailDTO } from '@aw/shared';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { toast } from '../../components/toast.tsx';
import { TASK_COPY as C } from '../../copy/tasks.ts';
import { useAbortAttempt } from '../attempts/attempt.queries.ts';
import { useRetryNode, useSkipNode } from '../tasks/tasks.queries.ts';

/** Steps that may be skipped (09 §3 `skip`). */
const SKIPPABLE: readonly NodeStatus[] = [NodeStatus.Pending, NodeStatus.Ready, NodeStatus.Failed];

const runningAttempt = (task: TaskDetailDTO, node: NodeSummaryDTO) =>
  task.activeAttempts.find(
    (a) => a.nodeId === node.id && a.kind === AttemptKind.Execute && a.status === AttemptStatus.Running,
  );

/** Whether the step has any action right now; a finished step has none. */
export const hasNodeActions = (task: TaskDetailDTO, node: NodeSummaryDTO) =>
  node.status === NodeStatus.Failed || SKIPPABLE.includes(node.status) || runningAttempt(task, node) !== undefined;

/** Pro step actions (M5-03): run a failed step again, skip it, or stop its running session. */
export function NodeActions({ task, node }: { task: TaskDetailDTO; node: NodeSummaryDTO }) {
  const skip = useSkipNode();
  const retry = useRetryNode();
  const abort = useAbortAttempt();
  const running = runningAttempt(task, node);
  const ids = { id: task.id, nodeId: node.id };
  const failure = skip.error ?? retry.error ?? abort.error;
  return (
    <div className="col">
      <div className="row wrap">
        {node.status === NodeStatus.Failed && (
          <Button
            size="sm"
            icon="refresh"
            pending={retry.isPending}
            onClick={() => retry.mutate(ids, { onSuccess: () => toast(C.retriedNode) })}
          >
            {C.retryNode}
          </Button>
        )}
        {SKIPPABLE.includes(node.status) && (
          <Button
            size="sm"
            icon="skip"
            pending={skip.isPending}
            onClick={() => skip.mutate(ids, { onSuccess: () => toast(C.skipped) })}
          >
            {C.skip}
          </Button>
        )}
        {running !== undefined && (
          <Button
            size="sm"
            variant="danger"
            icon="stop"
            pending={abort.isPending}
            onClick={() => abort.mutate(running.id, { onSuccess: () => toast(C.aborted) })}
          >
            {C.abort}
          </Button>
        )}
      </div>
      {failure !== null && <ErrorState error={failure} />}
    </div>
  );
}
