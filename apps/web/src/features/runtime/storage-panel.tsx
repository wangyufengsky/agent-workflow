import type { StorageCleanTarget } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Panel } from '../../components/panel.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY, formatBytes } from '../../copy/common.ts';
import { STORAGE_COPY as C } from '../../copy/storage.ts';
import styles from './runtime.module.css';
import { storageQuery, useCleanStorage } from './runtime.queries.ts';

/** Storage panel of the runtime page (37 §4): what the data takes and the two cleanups, each confirmed. */
export function StoragePanel() {
  const storage = useQuery(storageQuery);
  const clean = useCleanStorage();
  const [confirming, setConfirming] = useState<StorageCleanTarget | null>(null);
  const s = storage.data;
  return (
    <Panel
      title={C.title}
      actions={
        <span className="row">
          {s !== undefined && <span className="hint nowrap">{C.total(formatBytes(s.totalBytes))}</span>}
          <Button size="sm" icon="refresh" pending={storage.isFetching} onClick={() => void storage.refetch()}>
            {C.refresh}
          </Button>
        </span>
      }
    >
      {storage.isPending && <p className="hint">{C.measuring}</p>}
      {storage.isError && <ErrorState error={storage.error} onRetry={() => void storage.refetch()} />}
      {s !== undefined && (
        <div className="col" data-testid="storage">
          <ul className={styles.rows}>
            {s.items.map((item) => (
              <li key={item.kind}>
                <span className="grow ellipsis">{C.kind[item.kind]}</span>
                <span className="mono hint nowrap">{formatBytes(item.bytes)}</span>
              </li>
            ))}
          </ul>
          <p className="hint">{C.worktreesHint}</p>
          <dl className="kv">
            <dt>{C.dataDir}</dt>
            <dd className="mono">{s.dataDir}</dd>
            <dt>{C.worktreeRoot}</dt>
            <dd className="mono">{s.worktreeRoot}</dd>
          </dl>
          <h3 className="section-title">{C.cleanupTitle}</h3>
          <ul className={styles.rows}>
            {s.cleanable.map((c) => (
              <li key={c.target}>
                <span className="grow col">
                  <span className="ellipsis">{C.target[c.target].label}</span>
                  <span className="hint">{C.target[c.target].detail(c.count, formatBytes(c.bytes))}</span>
                </span>
                <Button size="sm" disabled={c.count === 0} onClick={() => setConfirming(c.target)}>
                  {C.clean}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {confirming !== null && (
        <Dialog
          open
          onOpenChange={(open) => !open && setConfirming(null)}
          title={C.target[confirming].confirmTitle}
          footer={
            <>
              <Button onClick={() => setConfirming(null)}>{COMMON_COPY.cancel}</Button>
              <Button
                variant="danger"
                pending={clean.isPending}
                onClick={() =>
                  clean.mutate(confirming, {
                    onSuccess: ({ freedBytes }) => {
                      toast(C.cleaned(formatBytes(freedBytes)));
                      setConfirming(null);
                    },
                  })
                }
              >
                {C.confirm}
              </Button>
            </>
          }
        >
          <p>{C.target[confirming].confirmBody}</p>
          {clean.isError && <ErrorState error={clean.error} />}
        </Dialog>
      )}
    </Panel>
  );
}
