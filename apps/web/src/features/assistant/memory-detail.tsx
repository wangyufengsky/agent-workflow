import type { AssistantMemoryDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Icon } from '../../components/icon.tsx';
import { MEMORY_COPY as C } from '../../copy/assistant.ts';
import { formatDateTime } from '../../copy/common.ts';
import { conversationsQuery } from './assistant.queries.ts';
import { titleOf } from './conversation-menu.tsx';
import styles from './memory-page.module.css';

export function MemoryScope({ projectName }: { projectName: string | undefined }) {
  return (
    <span className={styles.scope} data-project={projectName !== undefined || undefined}>
      <Icon name={projectName === undefined ? 'user' : 'folder'} size="sm" />
      <span className="ellipsis">{projectName ?? C.personal}</span>
    </span>
  );
}

function SourceConversation({ id }: { id: string }) {
  const conversations = useQuery(conversationsQuery);
  const source = conversations.data?.find((conversation) => conversation.id === id);
  if (conversations.isSuccess && source === undefined) return <p className="hint">{C.missingSource}</p>;
  return (
    <Link className={styles.source} to={ROUTES.home} search={{ conversation: id }} aria-label={C.openSource}>
      <Icon name="message" />
      <span className={styles.sourceText}>
        {source !== undefined && <strong className="ellipsis">{titleOf(source)}</strong>}
        <small>{C.openSource}</small>
      </span>
      <Icon name="external" size="sm" />
    </Link>
  );
}

export function MemoryDetail({
  memory,
  projectName,
  title,
  onEdit,
  onDelete,
}: {
  memory: AssistantMemoryDTO;
  projectName: string | undefined;
  title: string;
  onEdit(): void;
  onDelete(): void;
}) {
  return (
    <>
      <div className={styles.detailLabel}>
        <Icon name="memory" size="sm" /> {C.details}
      </div>
      <header className={styles.detailHeader}>
        <h2>{title}</h2>
        <MemoryScope projectName={projectName} />
      </header>
      <section className={styles.section}>
        <h3>{C.content}</h3>
        <p className={styles.content}>{memory.content}</p>
      </section>
      <section className={styles.section}>
        <h3>{C.applicability}</h3>
        <dl className={styles.meta}>
          <dt>{C.usedIn}</dt>
          <dd>{projectName === undefined ? C.everywhere : C.projectChat(projectName)}</dd>
          {memory.sourceConversationId !== null && (
            <>
              <dt>{C.savedVia}</dt>
              <dd>{C.confirmed}</dd>
            </>
          )}
          <dt>{C.lastUpdated}</dt>
          <dd>
            <time dateTime={new Date(memory.updatedAt).toISOString()}>{formatDateTime(memory.updatedAt)}</time>
          </dd>
        </dl>
      </section>
      <section className={styles.section}>
        <h3>{C.source}</h3>
        {memory.sourceConversationId === null ? (
          <p className="hint">{C.missingSource}</p>
        ) : (
          <SourceConversation id={memory.sourceConversationId} />
        )}
      </section>
      <div className={styles.actions}>
        <Button icon="edit" size="sm" onClick={onEdit}>
          {C.edit}
        </Button>
        <Button variant="danger" size="sm" onClick={onDelete}>
          {C.remove}
        </Button>
      </div>
    </>
  );
}
