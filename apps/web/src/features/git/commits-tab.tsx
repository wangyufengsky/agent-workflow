import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Button } from '../../components/button.tsx';
import { DiffBrowser } from '../../components/diff/diff-browser.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY, formatDateTime } from '../../copy/common.ts';
import { GIT_COPY as C } from '../../copy/git.ts';
import styles from './git.module.css';
import { gitBranchesQuery, gitCommitQuery, gitDiffFileQuery, gitLogQuery } from './git.queries.ts';

function CommitDetail({ projectId, sha, onBack }: { projectId: string; sha: string; onBack: () => void }) {
  const commit = useQuery(gitCommitQuery(projectId, sha));
  if (commit.isPending) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (commit.isError) return <ErrorState error={commit.error} onRetry={() => void commit.refetch()} />;
  const c = commit.data;
  return (
    <div className="col" data-testid="git-commit">
      <Button variant="ghost" size="sm" onClick={onBack}>
        {C.backToLog}
      </Button>
      <h3 className={styles.subject}>{c.subject}</h3>
      <span className="hint">
        <span className="mono">{c.sha.slice(0, 12)}</span> · {C.commitBy(c.authorName, formatDateTime(c.authoredAt))}
      </span>
      {c.body !== '' && <pre className={styles.code}>{c.body}</pre>}
      <DiffBrowser files={c.files} fileQuery={gitDiffFileQuery(projectId, c.base, c.sha)} />
    </div>
  );
}

/** Which ref the log shows: a branch from the list, or any commit typed in. */
function RefPicker({
  projectId,
  refName,
  onRef,
}: {
  projectId: string;
  refName: string;
  onRef: (ref: string) => void;
}) {
  const branches = useQuery(gitBranchesQuery(projectId)).data ?? [];
  const isBranch = branches.some((b) => b.name === refName);
  return (
    <div className={styles.refPicker}>
      <div className="field">
        <label className="label" htmlFor="log-branch">
          {C.branch}
        </label>
        <select
          id="log-branch"
          className="select mono"
          value={isBranch ? refName : ''}
          onChange={(e) => e.target.value !== '' && onRef(e.target.value)}
        >
          {!isBranch && <option value="">{C.otherRef(refName)}</option>}
          {branches.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const value = new FormData(e.currentTarget).get('ref');
          if (typeof value === 'string' && value.trim() !== '') onRef(value.trim());
        }}
      >
        <input
          name="ref"
          className="input mono"
          aria-label={C.ref}
          placeholder={C.refPlaceholder}
          defaultValue={isBranch ? '' : refName}
          // The branches arrive after the first render; until then the ref cannot be told from a commit.
          key={`${refName}|${isBranch}`}
        />
        <Button type="submit">{C.viewCommits}</Button>
      </form>
    </div>
  );
}

/** The log of a ref, page by page, and one commit with its diff. */
export function CommitsTab({
  projectId,
  refName,
  sha,
  onRef,
  onSha,
}: {
  projectId: string;
  refName: string;
  sha: string | undefined;
  onRef: (ref: string) => void;
  onSha: (sha: string | undefined) => void;
}) {
  const log = useInfiniteQuery({ ...gitLogQuery(projectId, refName), enabled: sha === undefined });
  if (sha !== undefined) return <CommitDetail projectId={projectId} sha={sha} onBack={() => onSha(undefined)} />;
  const commits = log.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="col">
      <RefPicker projectId={projectId} refName={refName} onRef={onRef} />
      {log.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {log.isError && <ErrorState error={log.error} onRetry={() => void log.refetch()} />}
      {log.isSuccess && commits.length === 0 && <p className="hint">{C.noCommits}</p>}
      <table className={styles.table} data-layout="fixed">
        <colgroup>
          <col />
          <col className={styles.shaCol} />
          <col className={styles.byCol} />
        </colgroup>
        <tbody>
          {commits.map((c) => (
            <tr key={c.sha} data-testid="git-log-entry">
              <td className={styles.subjectCell}>
                <button type="button" className={styles.rowButton} title={c.subject} onClick={() => onSha(c.sha)}>
                  {c.subject}
                </button>
              </td>
              <td className="mono hint">{c.sha.slice(0, 8)}</td>
              <td className="hint">{C.commitBy(c.authorName, formatDateTime(c.authoredAt))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {log.hasNextPage && (
        <Button pending={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
          {C.loadMore}
        </Button>
      )}
    </div>
  );
}
