import type { ErrorInfo, TaskFailedPhase } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Markdown } from '../../components/markdown.tsx';
import { TASK_COPY as C } from '../../copy/tasks.ts';
import { lastFailure, outputTail } from '../task-detail/last-failure.ts';
import { failedNodeKeyOf, failureText } from './failure-text.ts';
import { nodeQuery, taskQuery } from './tasks.queries.ts';

/** The same compact failure context in either entry point; full output stays on the step. */
export function FailureContext({ taskId, phase, error }: { taskId: string; phase: TaskFailedPhase; error: ErrorInfo }) {
  const task = useQuery(taskQuery(taskId)).data;
  const key = failedNodeKeyOf(error);
  const node = task?.nodes.find((item) => item.key === key);
  return (
    <div className="col" data-testid="failure-context">
      <p>
        <Markdown inline source={failureText(phase, error)} />
      </p>
      {node !== undefined && <LatestOutcome taskId={taskId} nodeId={node.id} />}
    </div>
  );
}

function LatestOutcome({ taskId, nodeId }: { taskId: string; nodeId: string }) {
  const node = useQuery(nodeQuery(taskId, nodeId)).data;
  if (node === undefined) return null;
  const last = lastFailure(node);
  if (last === null) return null;
  if (last.kind === 'command') {
    const { check } = last;
    if (check.unrunnable !== null) return null;
    const output = outputTail(check.output, 2).tail.slice(-300);
    return (
      <p>
        <Markdown inline source={C.lastCommand(check.command, check.exitCode, check.timedOut)} />
        {output !== '' && <span className="mono"> {output}</span>}
      </p>
    );
  }
  if (last.kind === 'attempt') return <p>{C.lastAttempt(last.aborted, last.error?.code)}</p>;
  return <p>{last.kind === 'review' ? C.lastReview : C.lastPage}</p>;
}
