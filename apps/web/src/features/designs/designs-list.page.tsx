import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { EmptyState } from '../../components/empty-state.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { Tabs } from '../../components/tabs.tsx';
import { COMMON_COPY, formatDateTime } from '../../copy/common.ts';
import { DESIGNS_COPY as C, DESIGN_STATUS_LABEL } from '../../copy/designs.ts';
import { projectsQuery } from '../projects/projects.queries.ts';
import styles from './designs.module.css';
import { designPagesQuery } from './designs.queries.ts';
import { TemplateLibrary } from './template-library.tsx';

const route = getRouteApi(ROUTE_IDS.designs);

function DesignList({ initialProject }: { initialProject: string }) {
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState(initialProject);
  const projects = useQuery(projectsQuery);
  const pages = useInfiniteQuery(
    designPagesQuery({
      ...(projectId === '' ? {} : { projectId }),
      ...(query.trim() === '' ? {} : { query: query.trim() }),
    }),
  );
  const items = pages.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = projectId !== '' || query.trim() !== '';
  return (
    <div className="col">
      <div className="row wrap">
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
        <select
          className="select"
          aria-label={C.allProjects}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">{C.allProjects}</option>
          {projects.data?.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>
      {pages.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {pages.isError && <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />}
      {projects.isError && <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />}
      {pages.isSuccess && items.length === 0 && (
        <EmptyState
          icon={filtered ? 'search' : 'book'}
          title={filtered ? C.noMatch : C.empty}
          {...(filtered ? {} : { body: C.emptyLede })}
          action={
            filtered ? (
              <Button
                onClick={() => {
                  setQuery('');
                  setProjectId('');
                }}
              >
                {C.reset}
              </Button>
            ) : (
              <Link className="btn primary" to={ROUTES.designNew}>
                {C.newDesign}
              </Link>
            )
          }
        />
      )}
      <div className={styles.grid}>
        {items.map((design) => (
          <Link
            className={`card pad ${styles.designCard}`}
            key={design.id}
            to={ROUTES.designWorkbench}
            params={{ designId: design.id }}
          >
            <div className="row wrap">
              <Icon name="book" />
              <strong className="grow">{design.title}</strong>
              <span className="badge">{DESIGN_STATUS_LABEL[design.status]}</span>
            </div>
            <div className="hint">
              {design.project?.name ?? C.absentProject} · {design.templateName}
            </div>
            <div className="hint">
              {design.commitSha === null
                ? C.snapshotAt(formatDateTime(design.scannedAt))
                : [design.branch, design.commitSha.slice(0, 7)].filter(Boolean).join(' · ')}
            </div>
            <div className="row wrap hint">
              <span className="grow">{C.coverage(design.analyzedCount, design.analyzableCount)}</span>
              <time dateTime={new Date(design.updatedAt).toISOString()}>
                {C.updated(formatDateTime(design.updatedAt))}
              </time>
            </div>
          </Link>
        ))}
      </div>
      {pages.hasNextPage && (
        <div>
          <Button pending={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
            {C.loadMore}
          </Button>
        </div>
      )}
    </div>
  );
}

export function DesignsListPage() {
  const search = route.useSearch();
  const navigate = useNavigate({ from: ROUTES.designs });
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{C.title}</h1>
          <p className="lede">{C.listLede}</p>
        </div>
        <Link to={ROUTES.designNew} search={{ projectId: search.projectId }} className="btn primary">
          <Icon name="plus" />
          {C.newDesign}
        </Link>
      </div>
      <Tabs
        value={search.tab ?? 'all'}
        onValueChange={(value) =>
          void navigate({
            search: (previous) => ({ ...previous, tab: value === 'templates' ? 'templates' : undefined }),
            replace: true,
          })
        }
        items={[
          {
            value: 'all',
            label: C.all,
            content: <DesignList key={search.projectId} initialProject={search.projectId ?? ''} />,
          },
          { value: 'templates', label: C.templateLibrary, content: <TemplateLibrary projectId={search.projectId} /> },
        ]}
      />
    </div>
  );
}
