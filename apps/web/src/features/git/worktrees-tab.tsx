import { resolveTaskDisplayGroup } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { GIT_COPY as C } from '../../copy/git.ts';
import { TaskBadge } from '../tasks/task-badge.tsx';
import styles from './git.module.css';
import { usePruneWorktrees, worktreesQuery } from './git.queries.ts';

/** Every worktree of the repository (11 §8): ours with their tasks, the user's, and stale entries. */
export function WorktreesTab({ projectId }: { projectId: string }) {
  const worktrees = useQuery(worktreesQuery(projectId));
  const prune = usePruneWorktrees(projectId);
  const [confirming, setConfirming] = useState(false);
  if (worktrees.isPending) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (worktrees.isError) return <ErrorState error={worktrees.error} onRetry={() => void worktrees.refetch()} />;
  return (
    <div className="col">
      <div className={styles.tableHead}>
        <h3>{C.views.worktrees}</h3>
        <span className={styles.spacer} />
        <Button size="sm" icon="trash" onClick={() => setConfirming(true)}>
          {C.prune}
        </Button>
      </div>
      {worktrees.data.length === 0 && <p className="hint">{C.noWorktrees}</p>}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{C.path}</th>
            <th>{C.branch}</th>
            <th>{C.task}</th>
            <th>{C.status}</th>
          </tr>
        </thead>
        <tbody>
          {worktrees.data.map((w) => (
            <tr key={w.path} data-testid="git-worktree">
              <td className={`mono ${styles.breakable}`}>{w.path}</td>
              <td className={`mono ${styles.breakable}`}>{w.branch ?? C.detached}</td>
              <td>
                {w.task !== null && (
                  <Link to={ROUTES.task} params={{ taskId: w.task.id }} className="row">
                    <span className="mono">{w.task.key}</span>
                    <TaskBadge group={resolveTaskDisplayGroup(w.task.status, false)} />
                  </Link>
                )}
              </td>
              <td>
                <div className={styles.status}>
                  <span className="chip">{w.main ? C.main : w.managed ? C.managed : C.external}</span>
                  {w.locked && <span className="chip">{C.locked}</span>}
                  {w.prunable && <span className="chip">{C.prunable}</span>}
                  {w.dirty === true && <span>{C.hasChanges}</span>}
                  {w.dirty === false && <span>{C.clean}</span>}
                  {w.ahead !== null && w.behind !== null && <span>{C.aheadBehind(w.ahead, w.behind)}</span>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={C.pruneTitle}
        description={C.pruneBody}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {COMMON_COPY.cancel}
            </Button>
            <Button
              variant="danger"
              pending={prune.isPending}
              onClick={() =>
                prune.mutate(undefined, {
                  onSuccess: () => {
                    toast(C.pruned);
                    setConfirming(false);
                  },
                })
              }
            >
              {C.prune}
            </Button>
          </>
        }
      >
        {prune.isError && <ErrorState error={prune.error} />}
      </Dialog>
    </div>
  );
}
