import { GitTreeEntryType, textLines } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { GIT_COPY as C } from '../../copy/git.ts';
import styles from './git.module.css';
import { gitFileQuery, gitTreeQuery } from './git.queries.ts';

function FileContent({
  projectId,
  refName,
  path,
  line,
}: {
  projectId: string;
  refName: string;
  path: string;
  line: number | undefined;
}) {
  const file = useQuery(gitFileQuery(projectId, refName, path));
  const anchor = useRef<HTMLElement>(null);
  const loaded = file.data;
  useEffect(() => {
    if (line === undefined || loaded === undefined) return;
    anchor.current?.scrollIntoView({ block: 'nearest' });
  }, [line, loaded]);
  if (file.isPending) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (file.isError) return <ErrorState error={file.error} />;
  const f = file.data;
  if ('binary' in f) return <p className="hint">{C.binary}</p>;
  if ('tooLarge' in f) return <p className="hint">{C.tooLarge(Math.ceil(f.size / 1024))}</p>;
  const lines = line === undefined ? undefined : textLines(f.content);
  const marked = line === undefined ? undefined : lines?.[line - 1];
  return (
    <pre className={styles.fileContent} data-testid="git-file">
      {line === undefined || lines === undefined || marked === undefined ? (
        f.content
      ) : (
        <>
          {lines.slice(0, line - 1).join('\n')}
          {line === 1 ? '' : '\n'}
          <mark ref={anchor} className={styles.fileLine} data-line={line}>
            {marked || ' '}
          </mark>
          {line < lines.length ? '\n' : ''}
          {lines.slice(line).join('\n')}
        </>
      )}
    </pre>
  );
}

/** Directories and files at a ref; `path` is a directory or, when a file is open, that file. */
export function FilesTab({
  projectId,
  refName,
  path,
  isFile,
  line,
  onOpen,
}: {
  projectId: string;
  refName: string;
  path: string;
  isFile: boolean;
  line?: number | undefined;
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
        <FileContent projectId={projectId} refName={refName} path={path} line={line} />
      ) : (
        <>
          {tree.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
          {tree.isError && <ErrorState error={tree.error} onRetry={() => void tree.refetch()} />}
          {tree.data?.length === 0 && <p className="hint">{C.empty}</p>}
          <ul className={styles.tree}>
            {tree.data?.map((entry) => (
              <li key={entry.path}>
                {entry.type === GitTreeEntryType.Commit ? (
                  <span className={`${styles.treeEntry} hint`}>
                    <Icon name="git" size="sm" />
                    {entry.name} · {C.submodule}
                  </span>
                ) : (
                  <button
                    type="button"
                    className={styles.treeEntry}
                    onClick={() => onOpen(entry.path, entry.type === GitTreeEntryType.Blob)}
                  >
                    <Icon name={entry.type === GitTreeEntryType.Tree ? 'folder' : 'file'} size="sm" />
                    <span className="ellipsis">{entry.name}</span>
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
