import { STATUS_TONE, UiMode } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { ErrorState } from '../../components/error-state.tsx';
import { Panel } from '../../components/panel.tsx';
import { StatusBadge } from '../../components/status-badge.tsx';
import { Tabs } from '../../components/tabs.tsx';
import { ATTEMPT_KIND_LABEL, ATTEMPT_STATUS_LABEL } from '../../copy/attempts.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { NODE_PAGE_COPY as C, NODE_COPY, TASK_COPY } from '../../copy/tasks.ts';
import { AttemptView } from '../attempts/attempt-view.tsx';
import { useSettings } from '../settings/settings.queries.ts';
import { hasNodeActions, NodeActions } from '../task-detail/node-actions.tsx';
import { Changes, NodeTabs, Output } from '../task-detail/node-drawer.tsx';
import { NodeBadge } from '../tasks/task-badge.tsx';
import { nodeQuery, taskQuery } from '../tasks/tasks.queries.ts';
import styles from './node-page.module.css';

const route = getRouteApi(ROUTE_IDS.node);

/**
 * Full step page of the pro view (M5-04, 14 §3.4): every attempt (execute and review) with its usage, full tool input
 * and output and reasoning, plus the step's output, changes and actions. In simple mode the page shows what the drawer
 * does: output, changes and the process in the user's words.
 */
export function NodePage() {
  const { taskId, nodeId } = route.useParams();
  const { attempt: attemptId } = route.useSearch();
  const navigate = route.useNavigate();
  const pro = useSettings()['ui.mode'] === UiMode.Pro;
  const task = useQuery(taskQuery(taskId));
  const node = useQuery(nodeQuery(taskId, nodeId));
  if (task.isPending || node.isPending) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (task.isError) return <ErrorState error={task.error} onRetry={() => void task.refetch()} />;
  if (node.isError) return <ErrorState error={node.error} onRetry={() => void node.refetch()} />;
  const n = node.data;
  const summary = task.data.nodes.find((s) => s.id === n.id);
  const selected = n.attempts.find((a) => a.id === attemptId) ?? n.attempts.at(-1);

  const process = (
    <div className={styles.process}>
      <nav className={styles.attempts} aria-label={C.attempts}>
        {n.attempts.length === 0 && <p className="hint">{NODE_COPY.noAttempt}</p>}
        {n.attempts.map((a) => (
          <button
            key={a.id}
            type="button"
            className={styles.attempt}
            aria-current={a.id === selected?.id}
            onClick={() => void navigate({ search: { attempt: a.id }, replace: true })}
          >
            <span>{C.attempt(ATTEMPT_KIND_LABEL[a.kind], a.seq)}</span>
            <StatusBadge tone={STATUS_TONE.attempt[a.status]} label={ATTEMPT_STATUS_LABEL[a.status]} />
          </button>
        ))}
      </nav>
      <div className={styles.attemptBody}>
        {selected === undefined ? null : <AttemptView key={selected.id} attemptId={selected.id} />}
      </div>
    </div>
  );

  const header = (
    <header className={styles.header}>
      <Link to={ROUTES.task} params={{ taskId }} search={{ node: nodeId }} className="crumbs">
        {C.back(task.data.key, task.data.title)}
      </Link>
      <div className="row">
        <h1 className="title grow">{n.title}</h1>
        <NodeBadge status={n.status} />
      </div>
      {pro ? (
        <span className="hint">
          {n.roleName} · {TASK_COPY.attempts(n.attemptCount)} · <span className="mono">{n.key}</span>
        </span>
      ) : (
        <span className="hint">{n.roleName}</span>
      )}
    </header>
  );
  if (!pro)
    return (
      <div className="page" data-testid="node-page">
        {header}
        <NodeTabs node={n} />
      </div>
    );

  return (
    <div className="page wide" data-testid="node-page">
      {header}
      <div className={styles.layout}>
        <Tabs
          items={[
            { value: 'process', label: NODE_COPY.process, content: process },
            { value: 'output', label: NODE_COPY.output, content: <Output node={n} /> },
            { value: 'changes', label: NODE_COPY.changes, content: <Changes node={n} /> },
          ]}
        />
        <aside className="col">
          {summary !== undefined && hasNodeActions(task.data, summary) && (
            <Panel title={C.actions}>
              <NodeActions task={task.data} node={summary} />
            </Panel>
          )}
          <Panel title={C.instructions}>
            <pre className={styles.instructions}>{n.instructions}</pre>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
