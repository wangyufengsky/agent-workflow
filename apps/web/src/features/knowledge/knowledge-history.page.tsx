import { type KnowledgeConversationSummaryDTO, STATUS_TONE } from '@aw/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { EmptyState } from '../../components/empty-state.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { StatusBadge } from '../../components/status-badge.tsx';
import { COMMON_COPY, formatDateTime } from '../../copy/common.ts';
import { ERROR_COPY } from '../../copy/errors.ts';
import { KNOWLEDGE_COPY as C } from '../../copy/knowledge.ts';
import { projectsQuery } from '../projects/projects.queries.ts';
import styles from './knowledge.module.css';
import { knowledgePagesQuery, useDeleteKnowledge } from './knowledge.queries.ts';

const route = getRouteApi(ROUTE_IDS.knowledgeHistory);
const DAY_MS = 86_400_000;

type Group = 'today' | 'yesterday' | 'earlier';
const GROUPS: readonly Group[] = ['today', 'yesterday', 'earlier'];

function groupOf(updatedAt: number, now: Date): Group {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (updatedAt >= startOfToday) return 'today';
  return updatedAt >= startOfToday - DAY_MS ? 'yesterday' : 'earlier';
}

function Row({ item, onDelete }: { item: KnowledgeConversationSummaryDTO; onDelete(): void }) {
  const { latest } = item;
  const line =
    latest.answerExcerpt ?? (latest.error === null ? C.status[latest.status] : ERROR_COPY[latest.error.code]);
  return (
    <li className={styles.historyRow}>
      <Link
        to={ROUTES.knowledgeConversation}
        params={{ conversationId: item.id }}
        className={styles.historyLink}
        data-testid="knowledge-history-row"
      >
        <span className="col grow">
          <span className={styles.historyTitle}>{item.title}</span>
          <span className="hint ellipsis">{line}</span>
          <span className={styles.historyMeta}>
            <StatusBadge tone={STATUS_TONE.knowledgeTurn[latest.status]} label={C.status[latest.status]} />
            <span className="hint">{item.project.name}</span>
            <span className="hint">{C.turns(item.turnCount)}</span>
            {latest.citationCount > 0 && <span className="hint">{C.citationCount(latest.citationCount)}</span>}
          </span>
        </span>
        <span className="hint nowrap">{formatDateTime(item.updatedAt)}</span>
      </Link>
      <IconButton icon="trash" label={C.delete} onClick={onDelete} />
    </li>
  );
}

/** Conversation history (18 §2.2): search, project filter, grouped by day; any row goes back to its conversation. */
export function KnowledgeHistoryPage() {
  const { q, projectId } = route.useSearch();
  const navigate = route.useNavigate();
  const projects = useQuery(projectsQuery).data ?? [];
  const pages = useInfiniteQuery(
    knowledgePagesQuery({
      ...(projectId === undefined ? {} : { projectId }),
      ...(q === undefined ? {} : { query: q }),
    }),
  );
  const remove = useDeleteKnowledge();
  const [deleting, setDeleting] = useState<string | undefined>(undefined);
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = q !== undefined || projectId !== undefined;
  const now = new Date();

  return (
    <div className="page narrow">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{C.historyTitle}</h1>
          <p className="lede">{C.historyLede}</p>
        </div>
        <Link to={ROUTES.knowledge} className="btn primary">
          <Icon name="plus" />
          {C.newConversation}
        </Link>
      </div>
      <div className={styles.toolbar}>
        <span className={`input-wrap ${styles.searchBox}`}>
          <Icon name="search" size="sm" />
          <input
            className="input ctl"
            type="search"
            aria-label={C.search}
            placeholder={C.search}
            value={q ?? ''}
            onChange={(e) =>
              void navigate({
                search: (prev) => ({ ...prev, q: e.target.value === '' ? undefined : e.target.value }),
                replace: true,
              })
            }
          />
        </span>
        <select
          className={`select ${styles.projectFilter}`}
          aria-label={C.project}
          value={projectId ?? ''}
          onChange={(e) =>
            void navigate({
              search: (prev) => ({ ...prev, projectId: e.target.value === '' ? undefined : e.target.value }),
              replace: true,
            })
          }
        >
          <option value="">{C.allProjects}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {pages.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {pages.isError && <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />}
      {pages.isSuccess && items.length === 0 && !filtered && (
        <EmptyState
          icon="book"
          title={C.historyEmptyTitle}
          body={C.historyEmptyBody}
          action={
            <Link to={ROUTES.knowledge} className="btn primary">
              {C.goAsk}
            </Link>
          }
        />
      )}
      {pages.isSuccess && items.length === 0 && filtered && (
        <EmptyState
          icon="search"
          title={C.noMatch}
          body={C.noMatchBody}
          action={<Button onClick={() => void navigate({ search: {}, replace: true })}>{C.clearFilter}</Button>}
        />
      )}
      {GROUPS.map((group) => {
        const rows = items.filter((item) => groupOf(item.updatedAt, now) === group);
        if (rows.length === 0) return null;
        return (
          <section key={group} className="section">
            <h2 className="eyebrow">{C[group]}</h2>
            <ul className={styles.historyList}>
              {rows.map((item) => (
                <Row key={item.id} item={item} onDelete={() => setDeleting(item.id)} />
              ))}
            </ul>
          </section>
        );
      })}
      {pages.hasNextPage && (
        <div className="row">
          <Button pending={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
            {COMMON_COPY.loadMore}
          </Button>
        </div>
      )}
      {deleting !== undefined && (
        <Dialog
          open
          onOpenChange={(open) => setDeleting(open ? deleting : undefined)}
          title={C.delete}
          footer={
            <Button
              variant="danger"
              pending={remove.isPending}
              onClick={() => remove.mutate(deleting, { onSuccess: () => setDeleting(undefined) })}
            >
              {C.delete}
            </Button>
          }
        >
          <p>{C.deleteConfirm}</p>
          {remove.isError && <ErrorState error={remove.error} />}
        </Dialog>
      )}
    </div>
  );
}
