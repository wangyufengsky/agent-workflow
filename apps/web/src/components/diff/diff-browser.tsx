import type { DiffFile, FileDiffDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DIFF_COPY as C } from '../../copy/diff.ts';
import { ErrorState } from '../error-state.tsx';
import styles from './diff.module.css';
import { type DiffMode, DiffView } from './diff-view.tsx';
import { FileTree } from './file-tree.tsx';

/** Query of one file's diff; the caller knows which endpoint serves it (task, step, or two refs). */
export type FileDiffQuery = (path: string) => { queryKey: readonly unknown[]; queryFn: () => Promise<FileDiffDTO> };

function FileDiff({ path, query, mode }: { path: string; query: FileDiffQuery; mode: DiffMode }) {
  const { queryKey, queryFn } = query(path);
  const diff = useQuery({ queryKey, queryFn });
  if (diff.isPending) return <p className="hint">{C.loading}</p>;
  if (diff.isError) return <ErrorState error={diff.error} onRetry={() => void diff.refetch()} />;
  return <DiffView file={diff.data} mode={mode} />;
}

/** File tree + one file's diff, unified or side by side (M4-07). */
export function DiffBrowser({ files, fileQuery }: { files: readonly DiffFile[]; fileQuery: FileDiffQuery }) {
  const [picked, setPicked] = useState<string | undefined>(undefined);
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
          <FileDiff path={selected} query={fileQuery} mode={mode} />
        )}
      </section>
    </div>
  );
}
