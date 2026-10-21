import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { EmptyState } from '../../components/empty-state.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { PPT_COPY as C } from '../../copy/ppt.ts';
import { projectsQuery } from '../projects/projects.queries.ts';
import { DeckCard } from './deck-card.tsx';
import styles from './ppt.module.css';
import { deckPagesQuery } from './ppt.queries.ts';

/** Every PPT, most recently updated first (23 §2.2). */
export function PptListPage() {
  const projects = useQuery(projectsQuery).data ?? [];
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState('');
  const filter = {
    ...(query.trim() === '' ? {} : { query: query.trim() }),
    ...(projectId === '' ? {} : { projectId }),
  };
  const pages = useInfiniteQuery(deckPagesQuery(filter));
  const decks = pages.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = query.trim() !== '' || projectId !== '';

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{C.title}</h1>
          <p className="lede">{C.lede}</p>
        </div>
        <Link to={ROUTES.pptNew} className="btn primary">
          <Icon name="plus" />
          {C.newDeck}
        </Link>
      </div>
      <div className={styles.toolbar}>
        <div className="input-wrap grow">
          <Icon name="search" size="sm" />
          <input
            className="input"
            type="search"
            aria-label={C.search}
            placeholder={C.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {projects.length > 1 && (
          <select
            className="select"
            aria-label={C.allProjects}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">{C.allProjects}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {pages.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {pages.isError && <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />}
      {pages.isSuccess && decks.length === 0 && !filtered && (
        <EmptyState
          icon="slides"
          title={C.emptyTitle}
          body={C.emptyBody}
          action={
            <Link to={ROUTES.pptNew} className="btn primary">
              {C.newDeck}
            </Link>
          }
        />
      )}
      {pages.isSuccess && decks.length === 0 && filtered && (
        <EmptyState
          icon="search"
          title={C.noMatch}
          action={
            <Button
              onClick={() => {
                setQuery('');
                setProjectId('');
              }}
            >
              {C.clearFilters}
            </Button>
          }
        />
      )}
      <div className={styles.deckGrid}>
        {decks.map((deck) => (
          <DeckCard key={deck.id} deck={deck} />
        ))}
      </div>
      {pages.hasNextPage && (
        <div className="row">
          <Button pending={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
            {C.loadMore}
          </Button>
        </div>
      )}
    </div>
  );
}
