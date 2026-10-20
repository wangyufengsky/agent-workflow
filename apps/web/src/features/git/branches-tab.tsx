import { resolveTaskDisplayGroup } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { DiffBrowser } from '../../components/diff/diff-browser.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { GIT_COPY as C } from '../../copy/git.ts';
import { TaskBadge } from '../tasks/task-badge.tsx';
import styles from './git.module.css';
import { gitBranchesQuery, gitDiffFileQuery, gitDiffQuery } from './git.queries.ts';

function Compare({ projectId, from, to }: { projectId: string; from: string; to: string }) {
  const diff = useQuery(gitDiffQuery(projectId, from, to));
  if (diff.isPending) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (diff.isError) return <ErrorState error={diff.error} />;
  return <DiffBrowser files={diff.data.files} fileQuery={gitDiffFileQuery(projectId, from, to)} />;
}

/** Local and remote branches, task branches marked, and a comparison of any two refs. */
export function BranchesTab({
  projectId,
  defaultBranch,
  onLog,
}: {
  projectId: string;
  defaultBranch: string;
  onLog: (ref: string) => void;
}) {
  const branches = useQuery(gitBranchesQuery(projectId));
  const [from, setFrom] = useState(defaultBranch);
  const [to, setTo] = useState('');
  const [compared, setCompared] = useState<{ from: string; to: string } | undefined>(undefined);
  if (branches.isPending) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (branches.isError) return <ErrorState error={branches.error} onRetry={() => void branches.refetch()} />;
  return (
    <div className="col">
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{C.branch}</th>
            <th>{C.task}</th>
            <th>{C.upstream}</th>
            <th>{C.lastCommit}</th>
          </tr>
        </thead>
        <tbody>
          {branches.data.map((b) => (
            <tr key={`${b.remote}:${b.name}`} data-testid="git-branch">
              <td>
                <button type="button" className={`mono ${styles.rowButton}`} onClick={() => onLog(b.name)}>
                  {b.name}
                </button>{' '}
                {b.current && <span className="chip">{C.current}</span>}
                {b.remote && <span className="chip">{C.remote}</span>}
              </td>
              <td>
                {b.task !== null && (
                  <Link to={ROUTES.task} params={{ taskId: b.task.id }} className="row">
                    <span className="mono">{b.task.key}</span>
                    <TaskBadge group={resolveTaskDisplayGroup(b.task.status, false)} />
                  </Link>
                )}
              </td>
              <td className="hint">
                {b.upstream === null ? '' : `${b.upstream} · ${C.aheadBehind(b.ahead, b.behind)}`}
              </td>
              <td className="ellipsis">{b.subject}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="sec-t">{C.compare}</h3>
      <div className={styles.toolbar}>
        <div className="field">
          <label className="label" htmlFor="compare-from">
            {C.compareFrom}
          </label>
          <input id="compare-from" className="input mono" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="compare-to">
            {C.compareTo}
          </label>
          <input id="compare-to" className="input mono" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button
          disabled={from.trim() === '' || to.trim() === ''}
          onClick={() => setCompared({ from: from.trim(), to: to.trim() })}
        >
          {C.compareRun}
        </Button>
      </div>
      {compared !== undefined && <Compare projectId={projectId} from={compared.from} to={compared.to} />}
    </div>
  );
}
