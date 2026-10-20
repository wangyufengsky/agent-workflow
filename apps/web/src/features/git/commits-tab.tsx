import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Button } from '../../components/button.tsx';
import { DiffBrowser } from '../../components/diff/diff-browser.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY, formatDateTime } from '../../copy/common.ts';
import { GIT_COPY as C } from '../../copy/git.ts';
import styles from './git.module.css';
import { gitCommitQuery, gitDiffFileQuery, gitLogQuery } from './git.queries.ts';

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
      <form
        className={styles.toolbar}
        onSubmit={(e) => {
          e.preventDefault();
          const value = new FormData(e.currentTarget).get('ref');
          if (typeof value === 'string' && value.trim() !== '') onRef(value.trim());
        }}
      >
        <div className="field">
          <label className="label" htmlFor="log-ref">
            {C.ref}
          </label>
          <input id="log-ref" name="ref" className="input mono" defaultValue={refName} key={refName} />
        </div>
        <Button type="submit">{C.viewCommits}</Button>
      </form>
      {log.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {log.isError && <ErrorState error={log.error} onRetry={() => void log.refetch()} />}
      {log.isSuccess && commits.length === 0 && <p className="hint">{C.noCommits}</p>}
      <table className={styles.table}>
        <tbody>
          {commits.map((c) => (
            <tr key={c.sha} data-testid="git-log-entry">
              <td>
                <button type="button" className={styles.rowButton} onClick={() => onSha(c.sha)}>
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
