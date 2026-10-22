import { AcceptanceCheckKind, AttemptKind, type CheckResult, type NodeDetailDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { DiffBrowser } from '../../components/diff/diff-browser.tsx';
import { Drawer } from '../../components/drawer.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { StatusBadge } from '../../components/status-badge.tsx';
import { Tabs } from '../../components/tabs.tsx';
import { STREAM_COPY } from '../../copy/attempts.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { NODE_COPY as C, TASK_COPY } from '../../copy/tasks.ts';
import { ConversationStream } from '../stream/conversation-stream.tsx';
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

/** A step's result, assumptions, notes and checks (14 §3.4「产出」). */
export function Output({ node }: { node: NodeDetailDTO }) {
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

/** A step's listed changes and its commit's diff (14 §3.4「改动」). */
export function Changes({ node }: { node: NodeDetailDTO }) {
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

/** The step's latest execute attempt in the simple view (14 §3.4「过程」, 25 §3). */
export function Process({ node }: { node: NodeDetailDTO }) {
  const attempt = latestExecute(node);
  if (attempt === undefined) return <p className="hint">{C.noAttempt}</p>;
  return (
    <ConversationStream
      key={attempt.id}
      attemptId={attempt.id}
      title={STREAM_COPY.processTitle}
      pro={false}
      size="drawer"
    />
  );
}

const latestExecute = (node: NodeDetailDTO) => node.attempts.filter((a) => a.kind === AttemptKind.Execute).at(-1);

/** A step without output yet opens on what the AI is doing; otherwise on its output. */
export const firstTab = (node: NodeDetailDTO) =>
  node.result === null && latestExecute(node) !== undefined ? 'process' : 'output';

/** The three tabs of a step in the simple view (14 §3.4). */
export function NodeTabs({ node }: { node: NodeDetailDTO }) {
  return (
    <Tabs
      key={node.id}
      defaultValue={firstTab(node)}
      items={[
        { value: 'output', label: C.output, content: <Output node={node} /> },
        { value: 'changes', label: C.changes, content: <Changes node={node} /> },
        { value: 'process', label: C.process, content: <Process node={node} /> },
      ]}
    />
  );
}

/**
 * Step details in a drawer beside the canvas (14 §3.4): output, changes, process; clicking another step on the canvas
 * shows that one. The pro view links to the full page (M5-04).
 */
export function NodeDrawer({
  taskId,
  nodeId,
  pro,
  onClose,
}: {
  taskId: string;
  nodeId: string | undefined;
  pro: boolean;
  onClose: () => void;
}) {
  const node = useQuery({ ...nodeQuery(taskId, nodeId ?? ''), enabled: nodeId !== undefined });
  return (
    <Drawer
      open={nodeId !== undefined}
      onOpenChange={(open) => !open && onClose()}
      title={node.data?.title ?? ''}
      size="lg"
      modal={false}
    >
      {node.isPending && nodeId !== undefined && <p className="hint">{COMMON_COPY.loading}</p>}
      {node.isError && <ErrorState error={node.error} onRetry={() => void node.refetch()} />}
      {node.data !== undefined && (
        <div className="col">
          <span className="row">
            <NodeBadge status={node.data.status} />
            <span className="hint grow">{node.data.roleName}</span>
            {pro && (
              <Link to={ROUTES.node} params={{ taskId, nodeId: node.data.id }} search={{}} className="btn secondary sm">
                {TASK_COPY.viewNodePage}
              </Link>
            )}
          </span>
          <NodeTabs node={node.data} />
        </div>
      )}
    </Drawer>
  );
}
