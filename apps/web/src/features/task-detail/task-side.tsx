import { AttemptKind, InboxKind, NodeStatus, type NodeSummaryDTO, type TaskDetailDTO } from '@aw/shared';
import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Elapsed } from '../../components/elapsed.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { Panel } from '../../components/panel.tsx';
import { STREAM_COPY } from '../../copy/attempts.ts';
import { TASK_COPY as C } from '../../copy/tasks.ts';
import { InboxCard } from '../inbox/inbox-card.tsx';
import { ConversationStream } from '../stream/conversation-stream.tsx';
import { NodeBadge } from '../tasks/task-badge.tsx';
import { NodeActions } from './node-actions.tsx';
import styles from './task-page.module.css';

/** A step the AI is working on, or whose result is being checked. */
const ACTIVE_STEP: readonly NodeStatus[] = [NodeStatus.Running, NodeStatus.WaitingInput, NodeStatus.Verifying];

/**
 * Right-hand panel (14 §3.3): open items answered in place, then the selected step's summary; with no step selected,
 * the step at work, the earliest started of them, and what it is doing (D118).
 */
export function TaskSide({
  task,
  selectedId,
  onOpen,
  pro = false,
}: {
  task: TaskDetailDTO;
  selectedId: string | undefined;
  onOpen: (nodeId: string) => void;
  /** Step actions and the full step page (M5-03, M5-04). */
  pro?: boolean;
}) {
  const node = task.nodes.find((n) => n.id === selectedId);
  const current =
    selectedId === undefined
      ? task.nodes
          .filter((n) => ACTIVE_STEP.includes(n.status))
          .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))[0]
      : undefined;
  // The failure panel above the canvas already says why the task failed and offers retry.
  const inbox = task.openInbox.filter((item) => item.kind !== InboxKind.Failure);
  return (
    <aside className={styles.side} data-testid="task-side">
      {inbox.length > 0 && (
        <Panel title={C.sideAttention}>
          <div className="col">
            {inbox.map((item) => (
              <InboxCard key={item.id} item={item} showTask={false} />
            ))}
          </div>
        </Panel>
      )}
      {current !== undefined ? (
        <CurrentStep task={task} node={current} onOpen={onOpen} />
      ) : (
        <Panel title={C.sideNode}>
          {node === undefined ? (
            <p className="hint">{C.sideNodeEmpty}</p>
          ) : (
            <div className="col">
              <span className="row">
                <span className="section-title grow">{node.title}</span>
                <NodeBadge status={node.status} />
              </span>
              <span className="hint">
                {node.roleName} · {C.attempts(node.attemptCount)}
              </span>
              {node.resultSummary !== null && <Markdown source={node.resultSummary} />}
              <div className="row">
                <Button size="sm" icon="chevRight" onClick={() => onOpen(node.id)}>
                  {C.viewNode}
                </Button>
                {pro && (
                  <Link
                    to={ROUTES.node}
                    params={{ taskId: task.id, nodeId: node.id }}
                    search={{}}
                    className="btn secondary sm"
                  >
                    {C.viewNodePage}
                  </Link>
                )}
              </div>
              {pro && <NodeActions task={task} node={node} />}
            </div>
          )}
        </Panel>
      )}
    </aside>
  );
}

/** The step at work: how long, and its session as it goes (D118). */
function CurrentStep({
  task,
  node,
  onOpen,
}: {
  task: TaskDetailDTO;
  node: NodeSummaryDTO;
  onOpen: (nodeId: string) => void;
}) {
  const attempt =
    task.activeAttempts.find((a) => a.nodeId === node.id && a.kind === AttemptKind.Review) ??
    task.activeAttempts.find((a) => a.nodeId === node.id && a.kind === AttemptKind.Execute);
  return (
    <Panel title={C.sideCurrent}>
      <div className="col" data-testid="current-step">
        <span className="row">
          <span className="section-title grow">{node.title}</span>
          <NodeBadge status={node.status} />
        </span>
        <span className="hint">
          {node.roleName}
          {node.startedAt !== null && (
            <>
              {' · '}
              <Elapsed since={node.startedAt} />
            </>
          )}
        </span>
        {attempt !== undefined && (
          <ConversationStream
            key={attempt.id}
            attemptId={attempt.id}
            title={attempt.kind === AttemptKind.Review ? STREAM_COPY.reviewTitle : STREAM_COPY.processTitle}
            pro={false}
            size="side"
          />
        )}
        <span>
          <Button size="sm" icon="chevRight" onClick={() => onOpen(node.id)}>
            {C.viewNode}
          </Button>
        </span>
      </div>
    </Panel>
  );
}
