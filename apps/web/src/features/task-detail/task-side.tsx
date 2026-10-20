import type { TaskDetailDTO } from '@aw/shared';
import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Panel } from '../../components/panel.tsx';
import { TASK_COPY as C } from '../../copy/tasks.ts';
import { InboxCard } from '../inbox/inbox-card.tsx';
import { NodeBadge } from '../tasks/task-badge.tsx';
import { NodeActions } from './node-actions.tsx';
import styles from './task-page.module.css';

/** Right-hand panel (14 §3.3): open items answered in place, then the selected step's summary. */
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
  return (
    <aside className={styles.side}>
      {task.openInbox.length > 0 && (
        <Panel title={C.sideAttention}>
          <div className="col">
            {task.openInbox.map((item) => (
              <InboxCard key={item.id} item={item} />
            ))}
          </div>
        </Panel>
      )}
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
            {node.resultSummary !== null && <p className="sub">{node.resultSummary}</p>}
            <div className="row">
              <Button size="sm" icon="chevRight" onClick={() => onOpen(node.id)}>
                {C.viewNode}
              </Button>
              {pro && (
                <Link to={ROUTES.node} params={{ taskId: task.id, nodeId: node.id }} search={{}} className="btn sm">
                  {C.viewNodePage}
                </Link>
              )}
            </div>
            {pro && <NodeActions task={task} node={node} />}
          </div>
        )}
      </Panel>
    </aside>
  );
}
