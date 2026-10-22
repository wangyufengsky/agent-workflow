import type { DiffFile, FileDiffDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DIFF_COPY as C } from '../../copy/diff.ts';
import { ErrorState } from '../error-state.tsx';
import styles from './diff.module.css';
import { type DiffFocus, type DiffMark, type DiffMode, DiffView } from './diff-view.tsx';
import { FileTree } from './file-tree.tsx';

/** Query of one file's diff; the caller knows which endpoint serves it (task, step, or two refs). */
export type FileDiffQuery = (path: string) => { queryKey: readonly unknown[]; queryFn: () => Promise<FileDiffDTO> };

/** One file's diff, read through `query`. */
export function FileDiff({
  path,
  query,
  mode,
  marks,
  focus,
}: {
  path: string;
  query: FileDiffQuery;
  mode: DiffMode;
  marks?: readonly DiffMark[] | undefined;
  focus?: DiffFocus | undefined;
}) {
  const diff = useQuery(query(path));
  if (diff.isPending) return <p className="hint">{C.loading}</p>;
  if (diff.isError) return <ErrorState error={diff.error} onRetry={() => void diff.refetch()} />;
  return <DiffView file={diff.data} mode={mode} marks={marks} focus={focus} />;
}

/**
 * File tree + one file's diff, unified or side by side (M4-07). The Git workbench controls which file is open (a
 * finding's location opens it at its line) and marks the lines its review found something on (27 §4.5).
 */
export function DiffBrowser({
  files,
  fileQuery,
  selected: controlled,
  onSelect,
  marks,
  focus,
}: {
  files: readonly DiffFile[];
  fileQuery: FileDiffQuery;
  selected?: string | undefined;
  onSelect?: ((path: string) => void) | undefined;
  marks?: ((path: string) => readonly DiffMark[]) | undefined;
  focus?: DiffFocus | undefined;
}) {
  const [own, setOwn] = useState<string | undefined>(undefined);
  const picked = controlled ?? own;
  const setPicked = onSelect ?? setOwn;
  const [mode, setMode] = useState<DiffMode>('unified');
  if (files.length === 0) return <p className="hint">{C.noFiles}</p>;
  // The first file until one is picked; a picked file that left the list falls back the same way.
  const selected = files.some((f) => f.path === picked) ? picked : files[0]?.path;
  return (
    <div className={styles.browser}>
      <FileTree files={files} selected={selected} onSelect={setPicked} />
      <section className={styles.pane} aria-label={selected}>
        <div className={styles.toolbar}>
          <span className="mono grow ellipsis">{selected}</span>
          {/* biome-ignore lint/a11y/useSemanticElements: a segmented control, not a form fieldset */}
          <div className="seg" role="group" aria-label={C.viewMode}>
            {(['unified', 'split'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
                {C[m]}
              </button>
            ))}
          </div>
        </div>
        {selected === undefined ? (
          <p className="hint">{C.pickFile}</p>
        ) : (
          <FileDiff
            path={selected}
            query={fileQuery}
            mode={mode}
            marks={marks?.(selected)}
            focus={selected === controlled ? focus : undefined}
          />
        )}
      </section>
    </div>
  );
}
