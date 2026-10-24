import {
  type GitBranchDTO,
  GitReviewTarget,
  type GitStatusDTO,
  isTerminalState,
  type ProjectDetailDTO,
  resolveTaskDisplayGroup,
  taskMachine,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { DiffBrowser } from '../../components/diff/diff-browser.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY, formatDateTime } from '../../copy/common.ts';
import { GIT_COPY as C } from '../../copy/git.ts';
import { TaskBadge } from '../tasks/task-badge.tsx';
import styles from './git.module.css';
import {
  gitBranchesQuery,
  gitCommitBeforeQuery,
  gitDiffFileQuery,
  gitDiffQuery,
  useStartReview,
  useSwitchBranch,
} from './git.queries.ts';
import type { GitDialog } from './git-dialogs.tsx';
import { GitMenu } from './git-menu.tsx';

/** A branch of an unfinished task: read-only here, merged and pushed from the task page (27 §5). */
export const isTaskOwned = (b: GitBranchDTO) => b.task !== null && !isTerminalState(taskMachine, b.task.status);

function Compare({
  projectId,
  from,
  to,
  onOpenReview,
}: {
  projectId: string;
  from: string;
  to: string;
  onOpenReview: (id: string) => void;
}) {
  const diff = useQuery(gitDiffQuery(projectId, from, to));
  const review = useStartReview(projectId);
  if (diff.isPending) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (diff.isError) return <ErrorState error={diff.error} />;
  return (
    <div className="col">
      <div className="row">
        <Button
          size="sm"
          icon="sparkle"
          pending={review.isPending}
          onClick={() =>
            review.mutate(
              { target: { kind: GitReviewTarget.Range, from, to } },
              { onSuccess: (started) => onOpenReview(started.id) },
            )
          }
        >
          {C.reviewRange}
        </Button>
      </div>
      {review.isError && <ErrorState error={review.error} />}
      <DiffBrowser files={diff.data.files} fileQuery={gitDiffFileQuery(projectId, from, to)} />
    </div>
  );
}

/** A comparison from a day (27 §4.2): the start is the commit `to` was at when the day began, in local time. */
function CompareSince({
  projectId,
  since,
  to,
  onOpenReview,
}: {
  projectId: string;
  since: string;
  to: string;
  onOpenReview: (id: string) => void;
}) {
  const start = useQuery(gitCommitBeforeQuery(projectId, to, new Date(`${since}T00:00`).getTime()));
  if (start.isPending) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (start.isError) return <ErrorState error={start.error} />;
  if (start.data === null) return <p className="hint">{C.noCommitBefore(to, since)}</p>;
  return (
    <div className="col">
      <p className="hint">
        {C.sinceStart(start.data.sha.slice(0, 7), start.data.subject, formatDateTime(start.data.authoredAt))}
      </p>
      <Compare projectId={projectId} from={start.data.sha} to={to} onOpenReview={onOpenReview} />
    </div>
  );
}

/**
 * Local and remote branches with their tasks, upstream and distance from the default branch, and what can be done
 * with each (27 §3.4); below, any two versions compared.
 */
export function BranchesView({
  project,
  status,
  onDialog,
  onLog,
  onReviewBranch,
  onOpenReview,
}: {
  project: ProjectDetailDTO;
  status: GitStatusDTO;
  onDialog: (dialog: GitDialog) => void;
  onLog: (ref: string) => void;
  onReviewBranch: (branch: string) => void;
  onOpenReview: (id: string) => void;
}) {
  const branches = useQuery(gitBranchesQuery(project.id));
  const switchTo = useSwitchBranch(project.id);
  const [showRemote, setShowRemote] = useState(false);
  const [from, setFrom] = useState(project.defaultBranch);
  const [since, setSince] = useState('');
  const [to, setTo] = useState('');
  const [compared, setCompared] = useState<{ from: string; since: string; to: string } | undefined>(undefined);
  if (branches.isPending) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (branches.isError) return <ErrorState error={branches.error} onRetry={() => void branches.refetch()} />;
  const all = branches.data;
  const local = all.filter((b) => !b.remote);
  const remote = all.filter((b) => b.remote);
  const shown = showRemote ? remote : local;
  const current = status.branch;
  const hasLocal = (name: string) => local.some((b) => b.name === name.slice(name.indexOf('/') + 1));

  const actions = (b: GitBranchDTO) => {
    if (isTaskOwned(b)) {
      return (
        <span className={styles.locked}>
          <Icon name="lock" size="sm" />
          {C.taskBranch}
        </span>
      );
    }
    const switchLabel = b.remote ? C.checkoutRemote : C.switchTo;
    return (
      <>
        {!b.current && (b.remote ? !hasLocal(b.name) : true) && (
          <Button
            size="sm"
            variant="ghost"
            icon="branch"
            pending={switchTo.isPending && switchTo.variables === b.name}
            onClick={() => switchTo.mutate(b.name, { onSuccess: () => toast(C.switchedTo(b.name)) })}
          >
            {switchLabel}
          </Button>
        )}
        {!b.current && current !== null && (
          <Button
            size="sm"
            variant="ghost"
            icon="merge"
            onClick={() => onDialog({ kind: 'merge', source: b.name, target: current })}
          >
            {C.mergeInto(current)}
          </Button>
        )}
        <GitMenu
          label={`${C.more} · ${b.name}`}
          className="icon-btn"
          trigger={<Icon name="more" />}
          items={[
            ...(b.remote
              ? []
              : [
                  { label: C.push, onSelect: () => onDialog({ kind: 'push', branch: b.name }) },
                  { label: C.createPr, onSelect: () => onDialog({ kind: 'pullRequest', branch: b.name }) },
                ]),
            { label: C.reviewBranch, onSelect: () => onReviewBranch(b.name) },
            { label: C.compareWith, onSelect: () => setTo(b.name) },
            { label: C.newBranch, onSelect: () => onDialog({ kind: 'newBranch', startPoint: b.name }) },
            ...(b.remote || b.current || b.name === project.defaultBranch
              ? []
              : [
                  null,
                  { label: C.deleteBranch, danger: true, onSelect: () => onDialog({ kind: 'delete', name: b.name }) },
                ]),
          ]}
        />
      </>
    );
  };

  return (
    <section className={styles.pagePad} aria-label={C.branches}>
      <div className={styles.tableHead}>
        <h3>{C.branches}</h3>
        {/* biome-ignore lint/a11y/useSemanticElements: a segmented control, not a form fieldset */}
        <div className="seg" role="group" aria-label={C.branches}>
          <button type="button" aria-pressed={!showRemote} onClick={() => setShowRemote(false)}>
            {C.local(local.length)}
          </button>
          <button type="button" aria-pressed={showRemote} onClick={() => setShowRemote(true)}>
            {C.remotes(remote.length)}
          </button>
        </div>
        <span className={styles.spacer} />
        <Button
          size="sm"
          variant="primary"
          icon="plus"
          onClick={() => onDialog({ kind: 'newBranch', startPoint: current ?? project.defaultBranch })}
        >
          {C.newBranch}
        </Button>
      </div>
      {switchTo.isError && <ErrorState error={switchTo.error} />}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{C.branch}</th>
            <th>{C.upstream}</th>
            <th>{C.lastCommit}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {shown.map((b) => (
            <tr key={`${b.remote}:${b.name}`} data-testid="git-branch">
              <td>
                <div className={styles.branchName}>
                  <button type="button" className={styles.rowButton} onClick={() => onLog(b.name)}>
                    {b.name}
                  </button>
                  {b.current && <span className="chip">{C.current}</span>}
                  {b.task !== null && (
                    <Link to={ROUTES.task} params={{ taskId: b.task.id }} className="row">
                      <span className={styles.ref} data-kind="task">
                        {b.task.key}
                      </span>
                      <TaskBadge group={resolveTaskDisplayGroup(b.task.status, false)} />
                    </Link>
                  )}
                </div>
              </td>
              <td className={styles.small}>
                {b.upstream === null
                  ? b.remote
                    ? ''
                    : C.noUpstream
                  : `${b.upstream} · ${b.ahead + b.behind === 0 ? C.synced : C.aheadBehind(b.ahead, b.behind)}`}
              </td>
              <td>
                <div className="ellipsis">{b.subject}</div>
                <div className={styles.small}>{formatDateTime(b.committedAt)}</div>
              </td>
              <td>
                <div className={styles.actions}>{actions(b)}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.fine}>
        <Icon name="info" size="sm" />
        {C.taskBranchHint}
      </p>

      <div className={styles.compare}>
        <div className="field">
          <label className="label" htmlFor="compare-from">
            {C.compareFrom}
          </label>
          <input
            id="compare-from"
            className="input mono"
            value={from}
            disabled={since !== ''}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="compare-since">
            {C.compareSince}
          </label>
          <input
            id="compare-since"
            type="date"
            className="input"
            value={since}
            max={new Date().toLocaleDateString('en-CA')}
            onChange={(e) => setSince(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="compare-to">
            {C.compareTo}
          </label>
          <input id="compare-to" className="input mono" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button
          disabled={(since === '' && from.trim() === '') || to.trim() === ''}
          onClick={() => setCompared({ from: from.trim(), since, to: to.trim() })}
        >
          {C.compareRun}
        </Button>
      </div>
      {since !== '' && (
        <p className={styles.fine}>
          <Icon name="info" size="sm" />
          {C.compareSinceHint}
        </p>
      )}
      {compared !== undefined &&
        (compared.since === '' ? (
          <Compare projectId={project.id} from={compared.from} to={compared.to} onOpenReview={onOpenReview} />
        ) : (
          <CompareSince projectId={project.id} since={compared.since} to={compared.to} onOpenReview={onOpenReview} />
        ))}
    </section>
  );
}
