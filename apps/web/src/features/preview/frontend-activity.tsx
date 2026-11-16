import { InboxKind, type TaskDetailDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { FRONTEND_COPY as C } from '../../copy/frontend.ts';
import { InboxCard } from '../inbox/inbox-card.tsx';
import { ConversationStream } from '../stream/conversation-stream.tsx';
import { nodeQuery } from '../tasks/tasks.queries.ts';
import styles from './frontend-workbench.module.css';

export function FrontendActivity({
  task,
  inMain,
  starting,
}: {
  task: TaskDetailDTO;
  inMain: boolean;
  starting: boolean;
}) {
  const active = task.activeAttempts.reduce<(typeof task.activeAttempts)[number] | undefined>(
    (latest, attempt) => (latest === undefined || attempt.startedAt >= latest.startedAt ? attempt : latest),
    undefined,
  );
  const lastNode = task.nodes.findLast((node) => node.attemptCount > 0);
  const node = task.nodes.find((item) => item.id === active?.nodeId) ?? lastNode;
  const history = useQuery({
    ...nodeQuery(task.id, lastNode?.id ?? ''),
    enabled: active === undefined && lastNode !== undefined,
  });
  const attempt = active ?? history.data?.attempts.at(-1);
  const inbox = task.openInbox.filter((item) => item.kind !== InboxKind.Failure);

  return (
    <div className={styles.activityFlow} data-testid="frontend-activity">
      {inMain && (
        <div className={styles.buildHeader}>
          <span className={styles.buildIcon}>
            <Icon name="terminal" size="lg" />
          </span>
          <div>
            <h2>{starting ? C.startingPreview : C.building}</h2>
            <p className="hint">{C.waitingHint}</p>
          </div>
        </div>
      )}
      {inbox.map((item) => (
        <InboxCard key={item.id} item={item} showTask={false} />
      ))}
      {attempt !== undefined ? (
        <ConversationStream
          key={attempt.id}
          attemptId={attempt.id}
          title={node?.title ?? C.activity}
          pro={false}
          size={inMain ? 'card' : 'side'}
          showLastActivity
        />
      ) : history.isError ? (
        <ErrorState error={history.error} onRetry={() => void history.refetch()} />
      ) : (
        <p className="hint">{history.fetchStatus === 'fetching' ? COMMON_COPY.loading : C.noActivity}</p>
      )}
    </div>
  );
}
