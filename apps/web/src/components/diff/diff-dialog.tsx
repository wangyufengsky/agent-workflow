import type { DiffFile } from '@aw/shared';
import * as RadixDialog from '@radix-ui/react-dialog';
import { type UseQueryOptions, useQuery } from '@tanstack/react-query';
import { type KeyboardEvent, useRef, useState } from 'react';
import { COMMON_COPY } from '../../copy/common.ts';
import { DIFF_COPY as C } from '../../copy/diff.ts';
import { ErrorState } from '../error-state.tsx';
import { IconButton } from '../icon-button.tsx';
import styles from './diff.module.css';
import { DiffBrowser, type FileDiffQuery } from './diff-browser.tsx';
import { treeOrder } from './file-tree.tsx';

const NEXT = new Set(['ArrowDown', 'j']);
const PREVIOUS = new Set(['ArrowUp', 'k']);

/**
 * The whole diff almost full screen (14 §2.3, D114): the files with their counts on the left, a file's diff on the
 * right; ↑↓ or j k switch files, Esc closes.
 */
export function DiffDialog<T extends { files: DiffFile[] }>({
  open,
  onOpenChange,
  title,
  query,
  fileQuery,
  path,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** The changed files; the caller knows which endpoint serves them (the task or one step). */
  query: UseQueryOptions<T, Error, T, string[]>;
  fileQuery: FileDiffQuery;
  /** The file to open on; the first one in the list when left out. */
  path?: string | undefined;
}) {
  const content = useRef<HTMLDivElement>(null);
  const diff = useQuery({ ...query, enabled: open });
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const order = diff.data === undefined ? [] : treeOrder(diff.data.files);
  const current = selected ?? path ?? order[0]?.path;
  const step = (e: KeyboardEvent) => {
    const by = NEXT.has(e.key) ? 1 : PREVIOUS.has(e.key) ? -1 : 0;
    if (by === 0 || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    const at = order.findIndex((f) => f.path === current);
    const next = order[Math.min(order.length - 1, Math.max(0, (at === -1 ? 0 : at) + by))];
    if (next !== undefined) setSelected(next.path);
  };
  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(next) => {
        // Opened again, it starts from `path` rather than the file left open last time.
        if (!next) setSelected(undefined);
        onOpenChange(next);
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={`scrim ${styles.largeScrim}`} />
        <RadixDialog.Content
          ref={content}
          className={`dialog ${styles.large}`}
          aria-describedby={undefined}
          onKeyDown={step}
          // The dialog itself takes focus so the keys work at once and the close button does not look selected.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            content.current?.focus();
          }}
        >
          <div className={styles.dialogHead}>
            <RadixDialog.Title className="grow">{title}</RadixDialog.Title>
            <span className="hint">{C.keysHint}</span>
            <RadixDialog.Close asChild>
              <IconButton icon="x" label={COMMON_COPY.close} />
            </RadixDialog.Close>
          </div>
          <div className={styles.dialogBody}>
            {diff.isPending && <p className="hint">{C.loading}</p>}
            {diff.isError && <ErrorState error={diff.error} onRetry={() => void diff.refetch()} />}
            {diff.data !== undefined && (
              <DiffBrowser
                files={diff.data.files}
                fileQuery={fileQuery}
                selected={current}
                onSelect={setSelected}
                fill
              />
            )}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
