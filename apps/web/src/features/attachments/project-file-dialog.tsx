import { GitTreeEntryType, type SnapshotProjectFileRequest } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { ATTACHMENTS_COPY as C } from '../../copy/attachments.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { gitTreeQuery } from '../git/git.queries.ts';
import styles from './attachments.module.css';

/** Where project files are picked from (30 §2.1): the main working tree, or a task's worktree on its branch. */
export type ProjectFileSource = { projectId: string; refName: string; taskId?: string };

const lineNumber = (value: string) => (/^[1-9]\d*$/.test(value) ? Number(value) : undefined);

/**
 * Picks one file of the project and, optionally, a line range. The tree is the one at `refName`; the backend reads
 * the file as it is on disk when it is added.
 */
export function ProjectFileDialog({
  source,
  onAdd,
  onClose,
}: {
  source: ProjectFileSource;
  onAdd: (input: SnapshotProjectFileRequest) => void;
  onClose: () => void;
}) {
  const [dir, setDir] = useState('');
  const [path, setPath] = useState<string>();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const tree = useQuery(gitTreeQuery(source.projectId, source.refName, dir));
  const parts = dir === '' ? [] : dir.split('/');
  const [first, last] = [lineNumber(from), lineNumber(to)];
  // Lines are both given (in order) or both left empty.
  const lines =
    from === '' && to === ''
      ? null
      : first !== undefined && last !== undefined && first <= last
        ? { from: first, to: last }
        : undefined;
  const add = () => {
    if (path === undefined || lines === undefined) return;
    onAdd({
      projectId: source.projectId,
      path,
      ...(source.taskId === undefined ? {} : { taskId: source.taskId }),
      ...(lines === null ? {} : { lines }),
    });
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={C.projectFileTitle}
      description={source.taskId === undefined ? C.projectFileMain : C.projectFileTask}
      footer={
        <Button variant="primary" disabled={path === undefined || lines === undefined} onClick={add}>
          {C.addSelected}
        </Button>
      }
    >
      <nav className={styles.crumbs} aria-label={C.projectFileTitle}>
        <button type="button" className={styles.crumb} onClick={() => setDir('')}>
          {C.root}
        </button>
        {parts.map((part, i) => {
          const at = parts.slice(0, i + 1).join('/');
          return (
            <span key={at}>
              /{' '}
              <button type="button" className={styles.crumb} onClick={() => setDir(at)}>
                {part}
              </button>
            </span>
          );
        })}
      </nav>
      <div className={styles.tree}>
        {tree.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
        {tree.isError && <ErrorState error={tree.error} onRetry={() => void tree.refetch()} />}
        {tree.data?.length === 0 && <p className="hint">{C.emptyDir}</p>}
        {tree.data
          ?.filter((entry) => entry.type !== GitTreeEntryType.Commit)
          .map((entry) =>
            entry.type === GitTreeEntryType.Tree ? (
              <button
                key={entry.path}
                type="button"
                className={styles.entry}
                aria-label={C.openDir(entry.name)}
                onClick={() => setDir(entry.path)}
              >
                <Icon name="folder" size="sm" />
                <span className="mono">{entry.name}/</span>
              </button>
            ) : (
              <button
                key={entry.path}
                type="button"
                className={styles.entry}
                aria-pressed={entry.path === path}
                onClick={() => setPath(entry.path)}
              >
                <Icon name="file" size="sm" />
                <span className="mono">{entry.name}</span>
              </button>
            ),
          )}
      </div>
      <p className="hint">{path === undefined ? C.noneSelected : C.selected(path)}</p>
      <div className="row">
        <label className="col grow">
          <span className="hint">{C.linesFrom}</span>
          <input className="input" inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="col grow">
          <span className="hint">{C.linesTo}</span>
          <input className="input" inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
    </Dialog>
  );
}
