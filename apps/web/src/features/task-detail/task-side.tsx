import type { TaskDetailDTO } from '@aw/shared';
import { Button } from '../../components/button.tsx';
import { Panel } from '../../components/panel.tsx';
import { TASK_COPY as C } from '../../copy/tasks.ts';
import { InboxCard } from '../inbox/inbox-card.tsx';
import { NodeBadge } from '../tasks/task-badge.tsx';
import styles from './task-page.module.css';

/** Right-hand panel (14 §3.3): open items answered in place, then the selected step's summary. */
export function TaskSide({
  task,
  selectedId,
  onOpen,
}: {
  task: TaskDetailDTO;
  selectedId: string | undefined;
  onOpen: (nodeId: string) => void;
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
            </div>
          </div>
        )}
      </Panel>
    </aside>
  );
}
