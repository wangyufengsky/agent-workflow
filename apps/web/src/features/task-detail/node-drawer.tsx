import {
  AcceptanceCheckKind,
  AttemptKind,
  type CheckResult,
  type NodeDetailDTO,
  NodeStatus,
  type StatusTone,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { DiffBrowser } from '../../components/diff/diff-browser.tsx';
import { DiffDialog } from '../../components/diff/diff-dialog.tsx';
import { Drawer } from '../../components/drawer.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { StatusBadge } from '../../components/status-badge.tsx';
import { Tabs } from '../../components/tabs.tsx';
import { STREAM_COPY } from '../../copy/attempts.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { DIFF_COPY } from '../../copy/diff.ts';
import { NODE_COPY as C, TASK_COPY } from '../../copy/tasks.ts';
import { PageCheckResultView } from '../preview/page-check-result.tsx';
import { ConversationStream } from '../stream/conversation-stream.tsx';
import { NodeBadge } from '../tasks/task-badge.tsx';
import { nodeDiffFileQuery, nodeDiffQuery, nodeQuery } from '../tasks/tasks.queries.ts';
import styles from './task-page.module.css';

/** The tabs of a step's details (14 §3.4); the task page's `?tab=` opens the drawer on one. */
export const NodeTab = { Output: 'output', Changes: 'changes', Process: 'process' } as const;
export type NodeTab = (typeof NodeTab)[keyof typeof NodeTab];

/**
 * A check's outcome; a command or page check may also have been skipped, or not run in the app's environment (D116).
 */
function checkBadge(check: CheckResult): { tone: StatusTone; label: string } {
  if (check.kind !== AcceptanceCheckKind.AiReview && check.skipped) return { tone: 'warn', label: C.checkSkipped };
  if (check.kind !== AcceptanceCheckKind.AiReview && check.unrunnable !== null)
    return { tone: 'danger', label: C.checkUnrunnable };
  return check.passed ? { tone: 'ok', label: C.checkPassed } : { tone: 'danger', label: C.checkFailed };
}

/** Steps run each check once, the commands told apart by their text. */
function checkKey(check: CheckResult): string {
  switch (check.kind) {
    case AcceptanceCheckKind.Command:
      return check.command;
    case AcceptanceCheckKind.Browser:
      return check.pages.map((p) => `${p.path}@${p.viewport}`).join(',');
    case AcceptanceCheckKind.AiReview:
      return check.attemptId;
  }
}

function Check({ taskId, check }: { taskId: string; check: CheckResult }) {
  const label =
    check.kind === AcceptanceCheckKind.Command
      ? C.commandCheck(check.command)
      : check.kind === AcceptanceCheckKind.Browser
        ? C.pageCheck
        : C.reviewCheck;
  const badge = checkBadge(check);
  return (
    <details>
      <summary className="row">
        <StatusBadge tone={badge.tone} label={badge.label} />
        <span className="mono ellipsis">{label}</span>
        {check.kind === AcceptanceCheckKind.Command && check.timedOut && <span className="hint">{C.timedOut}</span>}
        {check.kind === AcceptanceCheckKind.Command && check.unrunnable !== null && (
          <span className="hint">{C.unrunnableHint(check.unrunnable.program, check.unrunnable.reason)}</span>
        )}
      </summary>
      {check.kind === AcceptanceCheckKind.AiReview ? (
        <ReviewOutcome check={check} />
      ) : check.kind === AcceptanceCheckKind.Browser ? (
        <PageCheckResultView taskId={taskId} check={check} />
      ) : (
        <pre className={styles.output}>{check.output}</pre>
      )}
    </details>
  );
}

/** An AI review's summary and its issues, each with its location. */
export function ReviewOutcome({
  check,
}: {
  check: Extract<CheckResult, { kind: typeof AcceptanceCheckKind.AiReview }>;
}) {
  return (
    <div className="col">
      <Markdown source={check.output} />
      <ul>
        {check.issues.map((issue) => (
          <li key={`${issue.path}:${issue.line}:${issue.description}`}>
            [{issue.severity}]{' '}
            {issue.path === undefined ? '' : `${issue.path}${issue.line === undefined ? '' : `:${issue.line}`} `}
            <Markdown inline source={issue.description} />
          </li>
        ))}
      </ul>
    </div>
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
              <li key={a}>
                <Markdown inline source={a} />
              </li>
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
      {node.status === NodeStatus.Verifying && node.checkResults === null && (
        <>
          <h3 className="sec-t">{C.checks}</h3>
          <p className="hint">{C.checking}</p>
        </>
      )}
      {node.checkResults !== null && node.checkResults.length > 0 && (
        <>
          <h3 className="sec-t">{C.checks}</h3>
          {node.checkResults.map((check) => (
            <Check key={`${check.kind}-${checkKey(check)}`} taskId={node.taskId} check={check} />
          ))}
        </>
      )}
      {node.retryFeedback !== null && (
        <details>
          <summary className="hint">{C.retryFeedback}</summary>
          <Markdown source={node.retryFeedback} />
        </details>
      )}
    </div>
  );
}

/** A step's listed changes and its commit's diff (14 §3.4「改动」); the large view shows it almost full screen. */
export function Changes({ node }: { node: NodeDetailDTO }) {
  const changes = node.result?.changes ?? [];
  const diff = useQuery(nodeDiffQuery(node.taskId, node.id));
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="col">
      {changes.length > 0 && (
        <ul className={styles.files}>
          {changes.map((c) => (
            <li key={c.path} className={styles.change}>
              <span className={`mono ${styles.changePath}`}>{c.path}</span>
              <span className="hint">
                <Markdown inline source={c.description} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {node.commitSha === null ? (
        <p className="hint">{C.changesEmpty}</p>
      ) : (
        <>
          <span className="row">
            <span className="chip mono">{C.commit(node.commitSha)}</span>
            <span className="grow" />
            <Button size="sm" variant="ghost" icon="expand" onClick={() => setExpanded(true)}>
              {DIFF_COPY.expand}
            </Button>
          </span>
          {diff.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
          {diff.isError && <ErrorState error={diff.error} onRetry={() => void diff.refetch()} />}
          {diff.data !== undefined && (
            <DiffBrowser files={diff.data.files} fileQuery={nodeDiffFileQuery(node.taskId, node.id)} />
          )}
          <DiffDialog
            open={expanded}
            onOpenChange={setExpanded}
            title={C.changesOf(node.title)}
            query={nodeDiffQuery(node.taskId, node.id)}
            fileQuery={nodeDiffFileQuery(node.taskId, node.id)}
          />
        </>
      )}
    </div>
  );
}

/** 最近一轮执行与随后的 AI 评审共用会话流，评审中也能看到实际进展。 */
export function Process({ node }: { node: NodeDetailDTO }) {
  const attempt = latestExecute(node);
  if (attempt === undefined) return <p className="hint">{C.noAttempt}</p>;
  const attempts = node.attempts
    .slice(node.attempts.indexOf(attempt))
    .filter((a) => a.kind === AttemptKind.Execute || a.kind === AttemptKind.Review);
  return (
    <div className="col">
      {attempts.map((a) => (
        <ConversationStream
          key={a.id}
          attemptId={a.id}
          title={a.kind === AttemptKind.Review ? STREAM_COPY.reviewTitle : STREAM_COPY.processTitle}
          pro={false}
          size="drawer"
          foldOnEnd
        />
      ))}
    </div>
  );
}

const latestExecute = (node: NodeDetailDTO) => node.attempts.filter((a) => a.kind === AttemptKind.Execute).at(-1);

/** A step without output yet opens on what the AI is doing; otherwise on its output. */
export const firstTab = (node: NodeDetailDTO): NodeTab =>
  (node.result === null || node.status === NodeStatus.Verifying || node.status === NodeStatus.WaitingInput) &&
  latestExecute(node) !== undefined
    ? NodeTab.Process
    : NodeTab.Output;

/** The three tabs of a step in the simple view (14 §3.4), opening on `tab` when one is asked for. */
export function NodeTabs({ node, tab }: { node: NodeDetailDTO; tab?: NodeTab | undefined }) {
  return (
    <Tabs
      key={`${node.id}-${tab}`}
      defaultValue={tab ?? firstTab(node)}
      items={[
        { value: NodeTab.Output, label: C.output, content: <Output node={node} /> },
        { value: NodeTab.Changes, label: C.changes, content: <Changes node={node} /> },
        { value: NodeTab.Process, label: C.process, content: <Process node={node} /> },
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
  tab,
  pro,
  onClose,
}: {
  taskId: string;
  nodeId: string | undefined;
  tab?: NodeTab | undefined;
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
          <NodeTabs node={node.data} tab={tab} />
        </div>
      )}
    </Drawer>
  );
}
