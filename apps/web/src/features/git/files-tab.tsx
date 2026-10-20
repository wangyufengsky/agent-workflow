import { GitTreeEntryType } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { GIT_COPY as C } from '../../copy/git.ts';
import styles from './git.module.css';
import { gitFileQuery, gitTreeQuery } from './git.queries.ts';

function FileContent({ projectId, refName, path }: { projectId: string; refName: string; path: string }) {
  const file = useQuery(gitFileQuery(projectId, refName, path));
  if (file.isPending) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (file.isError) return <ErrorState error={file.error} />;
  const f = file.data;
  if ('binary' in f) return <p className="hint">{C.binary}</p>;
  if ('tooLarge' in f) return <p className="hint">{C.tooLarge(Math.ceil(f.size / 1024))}</p>;
  return (
    <pre className={styles.code} data-testid="git-file">
      {f.content}
    </pre>
  );
}

/** Directories and files at a ref; `path` is a directory or, when a file is open, that file. */
export function FilesTab({
  projectId,
  refName,
  path,
  isFile,
  onOpen,
}: {
  projectId: string;
  refName: string;
  path: string;
  isFile: boolean;
  onOpen: (path: string, isFile: boolean) => void;
}) {
  const dir = isFile ? path.split('/').slice(0, -1).join('/') : path;
  const tree = useQuery(gitTreeQuery(projectId, refName, dir));
  const parts = dir === '' ? [] : dir.split('/');
  return (
    <div className="col">
      <nav className={styles.crumbs} aria-label={C.path}>
        <button type="button" className={styles.rowButton} onClick={() => onOpen('', false)}>
          {C.root}
        </button>
        {parts.map((part, i) => (
          <span key={parts.slice(0, i + 1).join('/')}>
            /{' '}
            <button
              type="button"
              className={styles.rowButton}
              onClick={() => onOpen(parts.slice(0, i + 1).join('/'), false)}
            >
              {part}
            </button>
          </span>
        ))}
      </nav>
      {isFile ? (
        <FileContent projectId={projectId} refName={refName} path={path} />
      ) : (
        <>
          {tree.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
          {tree.isError && <ErrorState error={tree.error} onRetry={() => void tree.refetch()} />}
          {tree.data?.length === 0 && <p className="hint">{C.empty}</p>}
          <ul className="list">
            {tree.data?.map((entry) => (
              <li key={entry.path} className="list-row">
                {entry.type === GitTreeEntryType.Commit ? (
                  <span className="mono hint">
                    {entry.name} · {C.submodule}
                  </span>
                ) : (
                  <button
                    type="button"
                    className={`row mono ${styles.rowButton}`}
                    onClick={() => onOpen(entry.path, entry.type === GitTreeEntryType.Blob)}
                  >
                    <Icon name={entry.type === GitTreeEntryType.Tree ? 'folder' : 'list'} />
                    {entry.name}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
