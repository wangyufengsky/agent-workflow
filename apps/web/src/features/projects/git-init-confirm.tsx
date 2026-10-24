import { GIT_INIT_LARGE_TOTAL_BYTES, type ProjectDetailDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { formatBytes } from '../../copy/common.ts';
import { PROJECTS_COPY } from '../../copy/projects.ts';
import styles from './git-init-confirm.module.css';
import { gitInitPreviewQuery, useInitGit } from './projects.queries.ts';

const C = PROJECTS_COPY.gitInit;

/**
 * Offered when the chosen directory is in no Git repository (D153): the three things initialising does, with what the
 * first commit would take, and a warning when that is large.
 */
export function GitInitConfirm({
  repoPath,
  onAdded,
  onCancel,
}: {
  repoPath: string;
  onAdded: (project: ProjectDetailDTO) => void;
  onCancel: () => void;
}) {
  const preview = useQuery(gitInitPreviewQuery(repoPath));
  const init = useInitGit();
  const data = preview.data;
  const isLargeTotal = data !== undefined && data.bytes >= GIT_INIT_LARGE_TOTAL_BYTES;
  const isLarge = data !== undefined && (isLargeTotal || data.largeFileCount > 0);

  return (
    <section className="banner info" aria-labelledby="git-init-title" data-testid="git-init">
      <Icon name="git" />
      <div className="grow col">
        <strong id="git-init-title">{C.title}</strong>
        <span>{C.body}</span>
        {preview.isPending && <span className="hint">{C.counting}</span>}
        {preview.isError && <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />}
        {data !== undefined && (
          <>
            <ol className={styles.list}>
              <li>{C.stepInit}</li>
              <li>{data.gitignore === null ? C.stepKeepIgnore : C.stepIgnore(data.gitignore.trim().split('\n'))}</li>
              <li>{C.stepCommit(data.files, data.bytes)}</li>
            </ol>
            <span className="hint">{C.identity}</span>
          </>
        )}
        {isLarge && (
          <div className="banner warn" role="status" data-testid="git-init-large">
            <Icon name="alert" />
            <div className="grow col">
              <strong>{C.largeTitle}</strong>
              {isLargeTotal && <span>{C.largeTotal}</span>}
              {data.largeFileCount > 0 && (
                <>
                  <span>{C.largeFiles(data.largeFileCount)}</span>
                  <ul className={styles.list}>
                    {data.largeFiles.map((f) => (
                      <li key={f.path}>
                        <span className="mono">{f.path}</span>（{formatBytes(f.bytes)}）
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <span>{C.largeHint}</span>
            </div>
          </div>
        )}
        {init.isError && <ErrorState error={init.error} />}
        <div className="row">
          <Button
            variant="primary"
            icon="git"
            disabled={data === undefined}
            pending={init.isPending}
            onClick={() => init.mutate({ repoPath }, { onSuccess: onAdded })}
          >
            {C.run}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {C.cancel}
          </Button>
        </div>
      </div>
    </section>
  );
}
