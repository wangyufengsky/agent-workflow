import { InboxKind, type TaskDetailDTO, UiMode } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { FRONTEND_COPY as C } from '../../copy/frontend.ts';
import { TASK_COPY } from '../../copy/tasks.ts';
import { InboxCard } from '../inbox/inbox-card.tsx';
import { useSettings } from '../settings/settings.queries.ts';
import { ConversationStream } from '../stream/conversation-stream.tsx';
import { nodeQuery } from '../tasks/tasks.queries.ts';
import styles from './frontend-workbench.module.css';

export function FrontendActivity({
  task,
  inMain,
  starting,
  showInbox = true,
  nodeId,
  buildingTitle = C.building,
  buildingHint = C.waitingHint,
}: {
  task: TaskDetailDTO;
  inMain: boolean;
  starting: boolean;
  showInbox?: boolean;
  nodeId?: string;
  buildingTitle?: string;
  buildingHint?: string;
}) {
  const [step, setStep] = useState('');
  const [detailAttempt, setDetailAttempt] = useState<string>();
  const pro = useSettings()['ui.mode'] === UiMode.Pro;
  const executed = task.nodes.filter((item) => item.attemptCount > 0);
  const selected = executed.find((item) => item.id === (nodeId ?? step));
  const active = task.activeAttempts.reduce<(typeof task.activeAttempts)[number] | undefined>((latest, attempt) => {
    const target = nodeId ?? selected?.id;
    if (target !== undefined && attempt.nodeId !== target) return latest;
    return latest === undefined || attempt.startedAt >= latest.startedAt ? attempt : latest;
  }, undefined);
  const node =
    selected ??
    task.nodes.find((item) => item.id === active?.nodeId) ??
    (nodeId === undefined ? executed.at(-1) : undefined);
  const history = useQuery({
    ...nodeQuery(task.id, node?.id ?? ''),
    enabled: active === undefined && node !== undefined,
  });
  const attempt = active ?? history.data?.attempts.at(-1);
  const inbox = showInbox ? task.openInbox.filter((item) => item.kind !== InboxKind.Failure) : [];

  return (
    <div className={styles.activityFlow} data-testid="frontend-activity">
      {inMain && (
        <div className={styles.buildHeader}>
          <span className={styles.buildIcon}>
            <Icon name="terminal" size="lg" />
          </span>
          <div>
            <h2>{starting ? C.startingPreview : buildingTitle}</h2>
            <p className="hint">{buildingHint}</p>
          </div>
        </div>
      )}
      {inbox.map((item) => (
        <InboxCard key={item.id} item={item} showTask={false} />
      ))}
      {nodeId === undefined && executed.length > 1 && (
        <select
          className="input"
          aria-label={C.activityStep}
          value={selected?.id ?? ''}
          onChange={(e) => setStep(e.currentTarget.value)}
        >
          <option value="">{C.followStep}</option>
          {executed.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      )}
      {attempt !== undefined ? (
        <ConversationStream
          key={selected ? `selected:${attempt.id}` : attempt.id}
          attemptId={attempt.id}
          title={attempt.nodeId === null ? C.activity : node?.title}
          pro={pro}
          actions={
            attempt.nodeId === null ? (
              <button type="button" className={styles.activityDetails} onClick={() => setDetailAttempt(attempt.id)}>
                {TASK_COPY.viewNodePage}
                <Icon name="expand" size="sm" />
              </button>
            ) : (
              <Link
                to={ROUTES.node}
                params={{ taskId: task.id, nodeId: attempt.nodeId }}
                search={{ attempt: attempt.id }}
                className={styles.activityDetails}
              >
                {TASK_COPY.viewNodePage}
                <Icon name="external" size="sm" />
              </Link>
            )
          }
          size={inMain ? 'card' : 'side'}
          initiallyExpanded={selected !== undefined}
          showLastActivity
        />
      ) : history.isError ? (
        <ErrorState error={history.error} onRetry={() => void history.refetch()} />
      ) : (
        <p className="hint">{history.fetchStatus === 'fetching' ? COMMON_COPY.loading : C.noActivity}</p>
      )}
      <Dialog open={detailAttempt !== undefined} onOpenChange={() => setDetailAttempt(undefined)} title={C.activity}>
        {detailAttempt !== undefined && (
          <ConversationStream attemptId={detailAttempt} title={C.activity} pro={pro} size="page" initiallyExpanded />
        )}
      </Dialog>
    </div>
  );
}
