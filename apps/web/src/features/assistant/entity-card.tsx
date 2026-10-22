import { EntityKind, type EntityRef, ErrorCode, STATUS_TONE } from '@aw/shared';
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ApiError } from '../../api/client.ts';
import { ENTITY_ROUTES } from '../../app/entity-routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { StatusBadge } from '../../components/status-badge.tsx';
import { ENTITY_COPY as C } from '../../copy/assistant.ts';
import { BATCHES_COPY } from '../../copy/batches.ts';
import { KNOWLEDGE_COPY } from '../../copy/knowledge.ts';
import { frequencyText } from '../../copy/schedules.ts';
import { batchQuery } from '../batches/batches.queries.ts';
import { dbConnectionsQuery } from '../databases/databases.queries.ts';
import { gitReviewQuery } from '../git/git.queries.ts';
import { ReviewBadge } from '../git/git-parts.tsx';
import { knowledgeConversationQuery } from '../knowledge/knowledge.queries.ts';
import { deckCounts, deckStatusLabel } from '../ppt/deck-status.ts';
import { deckQuery } from '../ppt/ppt.queries.ts';
import { projectQuery } from '../projects/projects.queries.ts';
import { scheduleQuery } from '../schedules/schedules.queries.ts';
import { TaskBadge } from '../tasks/task-badge.tsx';
import { rolesQuery, taskQuery, workflowsQuery } from '../tasks/tasks.queries.ts';
import styles from './cards.module.css';
import { followAssistant } from './handoff.ts';

/** What the card knows about the object now: still loading, gone, or there (with a status for tasks). */
type Presence =
  | { state: 'loading' }
  | { state: 'deleted' }
  | { state: 'present'; status?: ReactNode }
  | { state: 'error'; error: unknown };

/** A detail query: its NOT_FOUND code means the object was deleted after it was produced. */
function byDetail(query: UseQueryResult, notFound: ErrorCode, status?: ReactNode): Presence {
  if (query.isError) {
    return query.error instanceof ApiError && query.error.code === notFound
      ? { state: 'deleted' }
      : { state: 'error', error: query.error };
  }
  return query.data === undefined
    ? { state: 'loading' }
    : { state: 'present', ...(status === undefined ? {} : { status }) };
}

/** A list query: an object missing from it was deleted. */
function byList<T>(query: UseQueryResult<T[]>, found: (item: T) => boolean): Presence {
  if (query.isError) return { state: 'error', error: query.error };
  if (query.data === undefined) return { state: 'loading' };
  return query.data.some(found) ? { state: 'present' } : { state: 'deleted' };
}

function Shell({ entity, presence }: { entity: EntityRef; presence: Presence }) {
  const navigate = useNavigate();
  const route = ENTITY_ROUTES[entity.kind];
  const deleted = presence.state === 'deleted';
  return (
    <section
      className={`${styles.card} ${styles.linkCard}`}
      data-deleted={deleted || undefined}
      aria-label={`${C.kind[entity.kind]}：${entity.title}`}
      data-testid="entity-card"
    >
      <div className={styles.cardHead}>
        <span className={styles.tile} data-tone="accent" aria-hidden="true">
          <Icon name={route.icon} size="sm" />
        </span>
        <span className={styles.cardHeading}>
          <span className={styles.eyebrow}>{C.kind[entity.kind]}</span>
          <span className={`${styles.cardTitle} ellipsis`}>{entity.title}</span>
        </span>
        {deleted ? <span className={styles.chip}>{C.deleted}</span> : presence.state === 'present' && presence.status}
        {/* The panel shows the conversation beside the page it opens, also from the home page (15 §6, D112). */}
        <Button size="sm" disabled={deleted} onClick={() => followAssistant(() => route.open(navigate, entity.id))}>
          {C.open}
        </Button>
      </div>
      {presence.state === 'error' && <ErrorState error={presence.error} />}
    </section>
  );
}

function TaskCard({ entity }: { entity: EntityRef }) {
  // `task.updated` keeps this query current, so the status follows the task as it runs.
  const query = useQuery(taskQuery(entity.id));
  const status = query.data === undefined ? undefined : <TaskBadge group={query.data.displayGroup} />;
  return <Shell entity={entity} presence={byDetail(query, ErrorCode.TaskNotFound, status)} />;
}

function ProjectCard({ entity }: { entity: EntityRef }) {
  return <Shell entity={entity} presence={byDetail(useQuery(projectQuery(entity.id)), ErrorCode.ProjectNotFound)} />;
}

function WorkflowCard({ entity }: { entity: EntityRef }) {
  return <Shell entity={entity} presence={byList(useQuery(workflowsQuery), (w) => w.key === entity.id)} />;
}

function RoleCard({ entity }: { entity: EntityRef }) {
  return <Shell entity={entity} presence={byList(useQuery(rolesQuery), (r) => r.id === entity.id)} />;
}

function DbConnectionCard({ entity }: { entity: EntityRef }) {
  return <Shell entity={entity} presence={byList(useQuery(dbConnectionsQuery), (c) => c.id === entity.id)} />;
}

function KnowledgeConversationCard({ entity }: { entity: EntityRef }) {
  // `knowledge.updated` keeps this query current, so the status follows the latest question.
  const query = useQuery(knowledgeConversationQuery(entity.id));
  const latest = query.data?.turns.at(-1);
  const status =
    latest === undefined ? undefined : (
      <StatusBadge tone={STATUS_TONE.knowledgeTurn[latest.status]} label={KNOWLEDGE_COPY.status[latest.status]} />
    );
  return <Shell entity={entity} presence={byDetail(query, ErrorCode.KnowledgeConversationNotFound, status)} />;
}

function BatchEntityCard({ entity }: { entity: EntityRef }) {
  // Under the task lists' cache prefix: `task.updated` keeps the progress current (20 §4).
  const query = useQuery(batchQuery(entity.id));
  const status =
    query.data === undefined ? undefined : (
      <span className="hint">
        {query.data.ended === query.data.total
          ? BATCHES_COPY.allFinished
          : BATCHES_COPY.progress(query.data.ended, query.data.total)}
      </span>
    );
  return <Shell entity={entity} presence={byDetail(query, ErrorCode.BatchNotFound, status)} />;
}

function DeckEntityCard({ entity }: { entity: EntityRef }) {
  // `deck.updated` keeps this query current: the card follows the outline and the making (D96).
  const query = useQuery(deckQuery(entity.id));
  const status =
    query.data === undefined ? undefined : (
      <StatusBadge tone={STATUS_TONE.deck[query.data.status]} label={deckStatusLabel(deckCounts(query.data))} />
    );
  return <Shell entity={entity} presence={byDetail(query, ErrorCode.DeckNotFound, status)} />;
}

function GitReviewEntityCard({ entity }: { entity: EntityRef }) {
  // `git_review.updated` keeps this query current while the review runs (27 §7.4).
  const query = useQuery(gitReviewQuery(entity.id));
  const status = query.data === undefined ? undefined : <ReviewBadge review={query.data} />;
  return <Shell entity={entity} presence={byDetail(query, ErrorCode.GitReviewNotFound, status)} />;
}

function ScheduleEntityCard({ entity }: { entity: EntityRef }) {
  const query = useQuery(scheduleQuery(entity.id));
  const status =
    query.data === undefined ? undefined : <span className="hint">{frequencyText(query.data.frequency)}</span>;
  return <Shell entity={entity} presence={byDetail(query, ErrorCode.ScheduleNotFound, status)} />;
}

/** A navigation card for an object an operation of the assistant produced (D66). */
export function EntityCard({ entity }: { entity: EntityRef }) {
  switch (entity.kind) {
    case EntityKind.Task:
      return <TaskCard entity={entity} />;
    case EntityKind.Project:
      return <ProjectCard entity={entity} />;
    case EntityKind.Workflow:
      return <WorkflowCard entity={entity} />;
    case EntityKind.Role:
      return <RoleCard entity={entity} />;
    case EntityKind.DbConnection:
      return <DbConnectionCard entity={entity} />;
    case EntityKind.KnowledgeConversation:
      return <KnowledgeConversationCard entity={entity} />;
    case EntityKind.Batch:
      return <BatchEntityCard entity={entity} />;
    case EntityKind.Deck:
      return <DeckEntityCard entity={entity} />;
    case EntityKind.Schedule:
      return <ScheduleEntityCard entity={entity} />;
    case EntityKind.GitReview:
      return <GitReviewEntityCard entity={entity} />;
  }
}
