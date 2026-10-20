import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Tabs } from '../../components/tabs.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { GIT_COPY as C } from '../../copy/git.ts';
import { projectQuery } from '../projects/projects.queries.ts';
import { BranchesTab } from './branches-tab.tsx';
import { CommitsTab } from './commits-tab.tsx';
import { FilesTab } from './files-tab.tsx';
import styles from './git.module.css';
import { gitStatusQuery, useFetch } from './git.queries.ts';
import { WorktreesTab } from './worktrees-tab.tsx';

const route = getRouteApi(ROUTE_IDS.gitProject);

export const GIT_TABS = ['branches', 'commits', 'files', 'worktrees'] as const;
export type GitTab = (typeof GIT_TABS)[number];

function Status({ projectId }: { projectId: string }) {
  const status = useQuery(gitStatusQuery(projectId));
  if (status.data === undefined) return null;
  const s = status.data;
  return (
    <p className={styles.status} data-testid="git-status">
      <span className="chip mono">{s.branch ?? C.detached}</span>
      {s.upstream !== null && <span>{C.aheadBehind(s.ahead, s.behind)}</span>}
      <span>{s.clean ? C.clean : C.dirty(s.files.length)}</span>
    </p>
  );
}

/** One repository in the Git console (M4-08); the tab and what it shows live in the URL. */
export function GitProjectPage() {
  const { projectId } = route.useParams();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const project = useQuery(projectQuery(projectId));
  const fetch = useFetch();
  if (project.isPending) return <p className="page hint">{COMMON_COPY.loading}</p>;
  if (project.isError) {
    return (
      <div className="page">
        <ErrorState error={project.error} onRetry={() => void project.refetch()} />
      </div>
    );
  }
  const p = project.data;
  const refName = search.ref ?? p.defaultBranch;
  const go = (next: Partial<typeof search>) => void navigate({ search: { ...search, ...next } });
  return (
    <div className="page wide">
      <div className="crumbs">
        <Link to={ROUTES.git}>{C.back}</Link>
        <span className="sep">/</span>
        <span className="cur">{p.name}</span>
      </div>
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{p.name}</h1>
          <Status projectId={projectId} />
        </div>
        <Button
          icon="refresh"
          pending={fetch.isPending}
          onClick={() => fetch.mutate(projectId, { onSuccess: () => toast(C.fetched) })}
        >
          {C.fetch}
        </Button>
      </div>
      {fetch.isError && <ErrorState error={fetch.error} />}
      <Tabs
        value={search.tab ?? 'branches'}
        onValueChange={(tab) => go({ tab: GIT_TABS.find((t) => t === tab) ?? 'branches' })}
        items={[
          {
            value: 'branches',
            label: C.tabs.branches,
            content: (
              <BranchesTab
                projectId={projectId}
                defaultBranch={p.defaultBranch}
                onLog={(ref) => go({ tab: 'commits', ref, sha: undefined })}
              />
            ),
          },
          {
            value: 'commits',
            label: C.tabs.commits,
            content: (
              <CommitsTab
                projectId={projectId}
                refName={refName}
                sha={search.sha}
                onRef={(ref) => go({ ref, sha: undefined })}
                onSha={(sha) => go({ sha })}
              />
            ),
          },
          {
            value: 'files',
            label: C.tabs.files,
            content: (
              <FilesTab
                projectId={projectId}
                refName={refName}
                path={search.path ?? ''}
                isFile={search.file === true}
                onOpen={(path, file) => go({ path, file })}
              />
            ),
          },
          { value: 'worktrees', label: C.tabs.worktrees, content: <WorktreesTab projectId={projectId} /> },
        ]}
      />
    </div>
  );
}
