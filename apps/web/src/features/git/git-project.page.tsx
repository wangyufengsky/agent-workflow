import { DiffSide, GitReviewTarget, type GitStatusDTO, type ProjectDetailDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, Navigate, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { DiffBrowser } from '../../components/diff/diff-browser.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY, formatTime } from '../../copy/common.ts';
import { GIT_COPY as C } from '../../copy/git.ts';
import { projectQuery, projectsQuery } from '../projects/projects.queries.ts';
import { BranchesView, isTaskOwned } from './branches-view.tsx';
import { type ChangePick, ChangesList, ChangesMain } from './changes-view.tsx';
import { CommitDetail } from './commit-detail.tsx';
import { CommitList } from './commit-list.tsx';
import { FilesTab } from './files-tab.tsx';
import styles from './git.module.css';
import {
  gitBranchesQuery,
  gitDiffFileQuery,
  gitReviewQuery,
  gitStatusQuery,
  useFetch,
  usePull,
  useRefreshOnFocus,
  useStartReview,
  useSwitchBranch,
} from './git.queries.ts';
import { type GitDialog, GitDialogs } from './git-dialogs.tsx';
import { GitMenu } from './git-menu.tsx';
import { reviewSearch, reviewTarget } from './review-location.ts';
import { ReviewPanel } from './review-panel.tsx';
import { WorktreesTab } from './worktrees-tab.tsx';

const route = getRouteApi(ROUTE_IDS.gitProject);

export const GIT_VIEWS = ['changes', 'commits', 'branches', 'files', 'worktrees', 'review'] as const;
export type GitView = (typeof GIT_VIEWS)[number];
export const DETAIL_TABS = ['files', 'review'] as const;

type Search = ReturnType<typeof route.useSearch>;
type Go = (next: Partial<Search>) => void;

function Toolbar({
  project,
  status,
  onDialog,
  go,
}: {
  project: ProjectDetailDTO;
  status: GitStatusDTO;
  onDialog: (dialog: GitDialog) => void;
  go: Go;
}) {
  const projects = useQuery(projectsQuery).data ?? [];
  const branches = useQuery(gitBranchesQuery(project.id)).data ?? [];
  const navigate = useNavigate();
  const fetch = useFetch(project.id);
  const pull = usePull(project.id);
  const switchTo = useSwitchBranch(project.id);
  const branch = status.branch;
  const owned = branches.some((b) => !b.remote && b.name === branch && isTaskOwned(b));
  const error = fetch.error ?? pull.error ?? switchTo.error;
  return (
    <div className="col">
      <div className={styles.bar} data-testid="git-status">
        <GitMenu
          label={C.switchProject}
          className={styles.branchChip}
          trigger={
            <>
              {project.name}
              <Icon name="chevDown" size="sm" />
            </>
          }
          items={projects.map((p) => ({
            label: p.name,
            onSelect: () => void navigate({ to: ROUTES.gitProject, params: { projectId: p.id } }),
          }))}
        />
        <GitMenu
          label={C.currentBranch}
          className={styles.branchChip}
          trigger={
            <>
              <Icon name="branch" size="sm" />
              {branch ?? C.detached}
              <Icon name="chevDown" size="sm" />
            </>
          }
          items={[
            ...branches
              .filter((b) => !b.remote && !isTaskOwned(b) && b.name !== branch)
              .map((b) => ({
                label: b.name,
                hint: C.switchTo,
                onSelect: () => switchTo.mutate(b.name, { onSuccess: () => toast(C.switchedTo(b.name)) }),
              })),
            null,
            { label: C.newBranch, onSelect: () => onDialog({ kind: 'newBranch', startPoint: branch ?? 'HEAD' }) },
          ]}
        />
        {status.upstream !== null && (
          <span className={styles.dist} title={status.upstream}>
            <Icon name="arrowUp" size="sm" />
            <b>{status.ahead}</b>
            <Icon name="arrowDown" size="sm" />
            <b>{status.behind}</b>
            <span>{status.upstream}</span>
          </span>
        )}
        {status.clean ? (
          <span className={`chip ${styles.okChip}`}>
            <Icon name="check" size="sm" />
            {C.clean}
          </span>
        ) : (
          <button type="button" className={`chip ${styles.warnChip}`} onClick={() => go({ view: 'changes' })}>
            <Icon name="edit" size="sm" />
            {C.dirty(status.files.length)}
          </button>
        )}
        <span className={styles.spacer} />
        <span className={styles.fetched}>
          {status.fetchedAt === null ? C.neverFetched : C.fetchedAt(formatTime(status.fetchedAt))}
        </span>
        <Button
          size="sm"
          icon="refresh"
          pending={fetch.isPending}
          onClick={() => fetch.mutate(undefined, { onSuccess: () => toast(C.fetched) })}
        >
          {C.fetch}
        </Button>
        <Button
          size="sm"
          icon="arrowDown"
          pending={pull.isPending}
          disabled={status.upstream === null}
          onClick={() => pull.mutate(undefined, { onSuccess: () => toast(C.pulled) })}
        >
          {C.pull}
          {status.behind > 0 && <span className={styles.count}>{status.behind}</span>}
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon="arrowUp"
          disabled={branch === null || owned}
          onClick={() => branch !== null && onDialog({ kind: 'push', branch })}
        >
          {C.push}
          {status.ahead > 0 && <span className={styles.count}>{status.ahead}</span>}
        </Button>
        <Button size="sm" icon="merge" disabled={branch === null || owned} onClick={() => go({ view: 'branches' })}>
          {C.merge}
        </Button>
      </div>
      {status.operation !== null && (
        <div className="banner warn" role="status">
          <Icon name="alert" />
          <div>
            <b>{C.operation[status.operation]}</b> {C.operationHint}
          </div>
        </div>
      )}
      {error !== null && <ErrorState error={error} />}
    </div>
  );
}

function Rail({
  project,
  status,
  view,
  refName,
  search,
  go,
  children,
}: {
  project: ProjectDetailDTO;
  status: GitStatusDTO;
  view: GitView;
  refName: string;
  search: Search;
  go: Go;
  children?: React.ReactNode;
}) {
  const branches = useQuery(gitBranchesQuery(project.id)).data ?? [];
  const local = branches.filter((b) => !b.remote);
  const remote = branches.filter((b) => b.remote);
  const views = (['changes', 'commits', 'branches', 'files', 'worktrees'] as const).map((v) => ({
    v,
    icon: ({ changes: 'edit', commits: 'git', branches: 'branch', files: 'folder', worktrees: 'layers' } as const)[v],
    n: v === 'changes' ? status.files.length : v === 'branches' ? local.length : undefined,
  }));
  const shortcut = (name: string, meta: string | undefined) => (
    <button
      key={name}
      type="button"
      className={styles.shortcut}
      aria-current={view === 'commits' && refName === name}
      onClick={() => go({ view: 'commits', ref: name, sha: undefined })}
    >
      <span className={styles.shortcutName}>{name}</span>
      {meta !== undefined && <span className={styles.shortcutMeta}>{meta}</span>}
    </button>
  );
  return (
    <aside className={styles.rail} aria-label={C.title}>
      <nav className={styles.railViews}>
        {views.map(({ v, icon, n }) => (
          <button
            key={v}
            type="button"
            className={styles.railView}
            aria-current={view === v}
            onClick={() => go({ view: v })}
          >
            <Icon name={icon} />
            {C.views[v]}
            {n !== undefined && <span className={styles.n}>{n}</span>}
          </button>
        ))}
      </nav>
      {children ?? (
        <>
          {view === 'commits' && (
            <form
              className={styles.filters}
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                const text = (name: string) => {
                  const value = data.get(name);
                  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
                };
                go({ author: text('author'), q: text('q'), sha: undefined });
              }}
            >
              <div className={styles.railCap}>{C.filters}</div>
              <select
                className="select mono"
                aria-label={C.branch}
                value={refName}
                onChange={(e) => go({ ref: e.target.value, sha: undefined })}
              >
                {branches.map((b) => (
                  <option key={`${b.remote}:${b.name}`} value={b.name}>
                    {b.name}
                  </option>
                ))}
                {!branches.some((b) => b.name === refName) && <option value={refName}>{refName}</option>}
              </select>
              <input
                name="author"
                className="input"
                aria-label={C.author}
                placeholder={C.authorPlaceholder}
                defaultValue={search.author ?? ''}
                key={`a:${search.author ?? ''}`}
              />
              <input
                name="q"
                className="input"
                aria-label={C.search}
                placeholder={C.searchPlaceholder}
                defaultValue={search.q ?? ''}
                key={`q:${search.q ?? ''}`}
              />
              <Button size="sm" type="submit" icon="search">
                {C.search}
              </Button>
            </form>
          )}
          <div className={styles.railCap}>{C.localBranches}</div>
          {local.map((b) => shortcut(b.name, b.current ? C.current : (b.task?.key ?? undefined)))}
          {remote.length > 0 && <div className={styles.railCap}>{C.remoteBranches('origin')}</div>}
          {remote.map((b) => shortcut(b.name, undefined))}
        </>
      )}
      <div className={styles.railFoot}>
        <Icon name={project.hosting === null ? 'info' : 'check'} size="sm" />
        <div>
          <b>{project.hosting === null ? C.hostingNone : C.hostingBound}</b>
          {project.hosting === null ? C.hostingCardNone : C.hostingCard(project.hosting.repo)}
        </div>
      </div>
    </aside>
  );
}

/** A branch or range review opened on its own (27 §4.2): its findings and the diff they point into. */
function ReviewView({ projectId, reviewId }: { projectId: string; reviewId: string }) {
  const review = useQuery(gitReviewQuery(reviewId));
  const [focus, setFocus] = useState<{ path: string; line: number | undefined; side: 'new' | 'old' } | undefined>();
  if (review.isPending) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (review.isError) return <ErrorState error={review.error} />;
  const r = review.data;
  const place = reviewSearch(r);
  // A worktree or commit review is shown where its diff is (a link to one may still name this view).
  if (place.view !== 'review') return <Navigate to={ROUTES.gitProject} params={{ projectId }} search={place} replace />;
  return (
    <div className={styles.changes}>
      <section className={styles.detail}>
        <div className={styles.detailHead}>
          <div className={styles.titleRow}>
            <h2>
              {C.targetLabel[r.target]} · <span className="mono">{r.label}</span>
            </h2>
          </div>
        </div>
        <ReviewPanel
          projectId={projectId}
          target={reviewTarget(r)}
          reviews={[r]}
          onLocate={(f) => setFocus({ path: f.path, line: f.line, side: f.side ?? DiffSide.New })}
        />
      </section>
      <section className={styles.diffPane}>
        {r.to !== null && (
          <DiffBrowser
            files={r.files}
            fileQuery={gitDiffFileQuery(projectId, r.from, r.to)}
            selected={focus?.path}
            onSelect={(path) => setFocus({ path, line: undefined, side: DiffSide.New })}
            marks={(path) =>
              r.findings
                .filter((f) => f.path === path && f.line !== undefined)
                .map((f) => ({ line: f.line ?? 0, side: f.side ?? DiffSide.New, severity: f.severity, title: f.title }))
            }
            focus={focus?.line === undefined ? undefined : { line: focus.line, side: focus.side }}
          />
        )}
      </section>
    </div>
  );
}

function Workbench({ project, status }: { project: ProjectDetailDTO; status: GitStatusDTO }) {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const [dialog, setDialog] = useState<GitDialog | null>(null);
  const [changePick, setChangePick] = useState<ChangePick | undefined>(undefined);
  const startReview = useStartReview(project.id);
  useRefreshOnFocus(project.id);
  const go: Go = (next) => void navigate({ search: { ...search, ...next } });
  const view: GitView = search.view ?? (status.clean ? 'commits' : 'changes');
  const refName = search.ref ?? status.branch ?? project.defaultBranch;
  const filter = { author: search.author, search: search.q };

  let body: React.ReactNode;
  if (view === 'changes') {
    body = (
      <div className={styles.cols} data-columns="two">
        <Rail project={project} status={status} view={view} refName={refName} search={search} go={go}>
          <ChangesList projectId={project.id} picked={changePick} onPick={setChangePick} />
        </Rail>
        <ChangesMain
          projectId={project.id}
          status={status}
          picked={changePick}
          showReview={search.tab === 'review'}
          onShowReview={(show) => go({ tab: show ? 'review' : undefined })}
          onPick={setChangePick}
          onPush={(branch) => setDialog({ kind: 'push', branch })}
        />
      </div>
    );
  } else if (view === 'commits') {
    body = (
      <div className={styles.cols}>
        <Rail project={project} status={status} view={view} refName={refName} search={search} go={go} />
        <CommitList
          projectId={project.id}
          refName={refName}
          filter={filter}
          selected={search.sha}
          onSelect={(sha) => go({ sha, parent: undefined, file: undefined, line: undefined })}
        />
        {search.sha === undefined ? (
          <p className={`hint ${styles.tabBody}`}>{C.pickCommit}</p>
        ) : (
          <CommitDetail
            projectId={project.id}
            sha={search.sha}
            parent={search.parent}
            tab={search.tab ?? 'files'}
            focus={
              search.path === undefined
                ? undefined
                : { path: search.path, line: search.line, side: search.side ?? DiffSide.New }
            }
            onChange={(next) =>
              go({
                ...('parent' in next ? { parent: next.parent } : {}),
                ...(next.tab === undefined ? {} : { tab: next.tab }),
                ...('focus' in next ? { path: next.focus?.path, line: next.focus?.line, side: next.focus?.side } : {}),
              })
            }
          />
        )}
      </div>
    );
  } else {
    let main: React.ReactNode;
    if (view === 'branches') {
      main = (
        <BranchesView
          onOpenReview={(reviewId) => go({ view: 'review', review: reviewId })}
          project={project}
          status={status}
          onDialog={setDialog}
          onLog={(ref) => go({ view: 'commits', ref, sha: undefined })}
          onReviewBranch={(branch) =>
            startReview.mutate(
              { target: { kind: GitReviewTarget.Branch, branch } },
              { onSuccess: (review) => go({ view: 'review', review: review.id }) },
            )
          }
        />
      );
    } else if (view === 'files') {
      main = (
        <div className={styles.pagePad}>
          <FilesTab
            projectId={project.id}
            refName={refName}
            path={search.path ?? ''}
            isFile={search.file === true}
            onOpen={(path, file) => go({ path, file })}
          />
        </div>
      );
    } else if (view === 'worktrees') {
      main = (
        <div className={styles.pagePad}>
          <WorktreesTab projectId={project.id} />
        </div>
      );
    } else {
      main =
        search.review === undefined ? (
          <p className="hint">{C.reviewNone}</p>
        ) : (
          <ReviewView projectId={project.id} reviewId={search.review} />
        );
    }
    body = (
      <div className={styles.cols} data-columns="two">
        <Rail project={project} status={status} view={view} refName={refName} search={search} go={go} />
        <div>
          {startReview.isError && <ErrorState error={startReview.error} />}
          {main}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.workbench}>
      <Toolbar project={project} status={status} onDialog={setDialog} go={go} />
      {body}
      <GitDialogs dialog={dialog} project={project} status={status} onClose={() => setDialog(null)} />
    </div>
  );
}

/** One repository in the Git workbench (27 §6.2); the view and what it shows live in the URL. */
export function GitProjectPage() {
  const { projectId } = route.useParams();
  const project = useQuery(projectQuery(projectId));
  const status = useQuery(gitStatusQuery(projectId));
  if (project.isPending || status.isPending) return <p className="page hint">{COMMON_COPY.loading}</p>;
  if (project.isError || status.isError) {
    return (
      <div className="page">
        <div className="crumbs">
          <Link to={ROUTES.git}>{C.back}</Link>
        </div>
        <ErrorState error={project.error ?? status.error} onRetry={() => void project.refetch()} />
      </div>
    );
  }
  return <Workbench project={project.data} status={status.data} />;
}
