import { AcceptanceCheckKind, AttemptKind, type CheckResult, type NodeDetailDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { DiffBrowser } from '../../components/diff/diff-browser.tsx';
import { Drawer } from '../../components/drawer.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { StatusBadge } from '../../components/status-badge.tsx';
import { Tabs } from '../../components/tabs.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { NODE_COPY as C } from '../../copy/tasks.ts';
import { TranscriptView } from '../attempts/transcript-view.tsx';
import { NodeBadge } from '../tasks/task-badge.tsx';
import { nodeDiffFileQuery, nodeDiffQuery, nodeQuery } from '../tasks/tasks.queries.ts';
import styles from './task-page.module.css';

function Check({ check }: { check: CheckResult }) {
  const label = check.kind === AcceptanceCheckKind.Command ? C.commandCheck(check.command) : C.reviewCheck;
  return (
    <details>
      <summary className="row">
        <StatusBadge tone={check.passed ? 'ok' : 'danger'} label={check.passed ? C.checkPassed : C.checkFailed} />
        <span className="mono ellipsis">{label}</span>
        {check.kind === AcceptanceCheckKind.Command && check.timedOut && <span className="hint">{C.timedOut}</span>}
      </summary>
      {check.kind === AcceptanceCheckKind.Command ? (
        <pre className={styles.output}>{check.output}</pre>
      ) : (
        <div className="col">
          <Markdown source={check.output} />
          <ul>
            {check.issues.map((issue) => (
              <li key={`${issue.path}:${issue.line}:${issue.description}`}>
                [{issue.severity}]{' '}
                {issue.path === undefined ? '' : `${issue.path}${issue.line === undefined ? '' : `:${issue.line}`} `}
                {issue.description}
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}

function Output({ node }: { node: NodeDetailDTO }) {
  const { result } = node;
  return (
    <div className="col">
      {result === null ? <p className="hint">{C.noResult}</p> : <Markdown source={result.summary} />}
      {result?.assumptions !== undefined && result.assumptions.length > 0 && (
        <>
          <h3 className="sec-t">{C.assumptions}</h3>
          <ul>
            {result.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </>
      )}
      {result?.notes !== undefined && (
        <>
          <h3 className="sec-t">{C.notes}</h3>
          <Markdown source={result.notes} />
        </>
      )}
      {node.checkResults !== null && node.checkResults.length > 0 && (
        <>
          <h3 className="sec-t">{C.checks}</h3>
          {node.checkResults.map((check) => (
            <Check
              key={`${check.kind}-${check.kind === AcceptanceCheckKind.Command ? check.command : check.attemptId}`}
              check={check}
            />
          ))}
        </>
      )}
      {node.retryFeedback !== null && (
        <details>
          <summary className="hint">{C.retryFeedback}</summary>
          <pre className={styles.output}>{node.retryFeedback}</pre>
        </details>
      )}
    </div>
  );
}

function Changes({ node }: { node: NodeDetailDTO }) {
  const changes = node.result?.changes ?? [];
  const diff = useQuery(nodeDiffQuery(node.taskId, node.id));
  return (
    <div className="col">
      {changes.length > 0 && (
        <ul className={styles.files}>
          {changes.map((c) => (
            <li key={c.path} className={styles.file}>
              <span className="mono">{c.path}</span>
              <span className="hint ellipsis">{c.description}</span>
            </li>
          ))}
        </ul>
      )}
      {node.commitSha === null ? (
        <p className="hint">{C.changesEmpty}</p>
      ) : (
        <>
          <span className="chip mono">{C.commit(node.commitSha)}</span>
          {diff.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
          {diff.isError && <ErrorState error={diff.error} onRetry={() => void diff.refetch()} />}
          {diff.data !== undefined && (
            <DiffBrowser files={diff.data.files} fileQuery={nodeDiffFileQuery(node.taskId, node.id)} />
          )}
        </>
      )}
    </div>
  );
}

/** Session replay of the step's latest execute attempt, following new lines while running. */
function Process({ node }: { node: NodeDetailDTO }) {
  const [follow, setFollow] = useState(true);
  const end = useRef<HTMLDivElement>(null);
  const attempt = node.attempts.filter((a) => a.kind === AttemptKind.Execute).at(-1);
  useEffect(() => {
    if (follow) end.current?.scrollIntoView({ block: 'end' });
  });
  if (attempt === undefined) return <p className="hint">{C.noAttempt}</p>;
  return (
    <div className="col">
      <span className="row">
        <span className="hint grow">{C.attemptOf(attempt.seq)}</span>
        <label className="check">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          <span>{C.follow}</span>
        </label>
      </span>
      <TranscriptView attemptId={attempt.id} />
      <div ref={end} />
    </div>
  );
}

/** Step details in a drawer (14 §3.4): output, changes, process. */
export function NodeDrawer({
  taskId,
  nodeId,
  onClose,
}: {
  taskId: string;
  nodeId: string | undefined;
  onClose: () => void;
}) {
  const node = useQuery({ ...nodeQuery(taskId, nodeId ?? ''), enabled: nodeId !== undefined });
  return (
    <Drawer
      open={nodeId !== undefined}
      onOpenChange={(open) => !open && onClose()}
      title={node.data?.title ?? ''}
      size="wide"
    >
      {node.isPending && nodeId !== undefined && <p className="hint">{COMMON_COPY.loading}</p>}
      {node.isError && <ErrorState error={node.error} onRetry={() => void node.refetch()} />}
      {node.data !== undefined && (
        <div className="col">
          <span className="row">
            <NodeBadge status={node.data.status} />
            <span className="hint">{node.data.roleName}</span>
          </span>
          <Tabs
            items={[
              { value: 'output', label: C.output, content: <Output node={node.data} /> },
              { value: 'changes', label: C.changes, content: <Changes node={node.data} /> },
              { value: 'process', label: C.process, content: <Process node={node.data} /> },
            ]}
          />
        </div>
      )}
    </Drawer>
  );
}
