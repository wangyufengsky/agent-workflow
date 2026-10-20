import type { DiffFile } from '@aw/shared';
import { useMemo } from 'react';
import { DIFF_COPY as C } from '../../copy/diff.ts';
import styles from './diff.module.css';

type TreeDir = { name: string; path: string; dirs: TreeDir[]; files: DiffFile[] };

/** Directories of the changed paths, with chains of single directories joined (`src/modules/git`). */
function buildTree(files: readonly DiffFile[]): TreeDir {
  const root: TreeDir = { name: '', path: '', dirs: [], files: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      const path = dir.path === '' ? part : `${dir.path}/${part}`;
      let next = dir.dirs.find((d) => d.name === part);
      if (next === undefined) {
        next = { name: part, path, dirs: [], files: [] };
        dir.dirs.push(next);
      }
      dir = next;
    }
    dir.files.push(file);
  }
  const compact = (dir: TreeDir): TreeDir => {
    const dirs = dir.dirs.map(compact);
    const [only] = dirs;
    if (dir.path !== '' && dir.files.length === 0 && dirs.length === 1 && only !== undefined) {
      return { ...only, name: `${dir.name}/${only.name}` };
    }
    return { ...dir, dirs };
  };
  return compact(root);
}

function Stat({ file }: { file: DiffFile }) {
  if (file.additions === null) return <span className="hint">{C.binaryStat}</span>;
  return (
    <span className={styles.stat}>
      <span className={styles.add}>+{file.additions}</span>
      <span className={styles.del}>−{file.deletions}</span>
    </span>
  );
}

function Dir({
  dir,
  selected,
  onSelect,
}: {
  dir: TreeDir;
  selected: string | undefined;
  onSelect: (p: string) => void;
}) {
  return (
    <ul className={styles.tree}>
      {dir.dirs.map((d) => (
        <li key={d.path}>
          <span className={styles.dir}>{d.name}/</span>
          <Dir dir={d} selected={selected} onSelect={onSelect} />
        </li>
      ))}
      {dir.files.map((file) => (
        <li key={file.path}>
          <button
            type="button"
            className={styles.file}
            aria-pressed={file.path === selected}
            title={`${C.status[file.status]} · ${file.path}`}
            onClick={() => onSelect(file.path)}
          >
            <span className={styles.status} data-status={file.status}>
              {C.status[file.status]}
            </span>
            <span className="grow ellipsis mono">{file.path.split('/').at(-1)}</span>
            <Stat file={file} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Changed files as a tree; the selected one is shown in the diff view next to it. */
export function FileTree({
  files,
  selected,
  onSelect,
}: {
  files: readonly DiffFile[];
  selected: string | undefined;
  onSelect: (path: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  return (
    <nav aria-label={C.files} className={styles.treeRoot}>
      <Dir dir={tree} selected={selected} onSelect={onSelect} />
    </nav>
  );
}
