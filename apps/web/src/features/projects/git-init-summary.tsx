import { GIT_INIT_LARGE_TOTAL_BYTES, type GitInitPreviewDTO } from '@aw/shared';
import { Icon } from '../../components/icon.tsx';
import { formatBytes } from '../../copy/common.ts';
import { PROJECTS_COPY } from '../../copy/projects.ts';
import styles from './git-init-summary.module.css';

const C = PROJECTS_COPY.gitInit;

/**
 * What putting a directory under Git does (D153): the three steps with what the first commit would take, and a warning
 * when that is large. Shown in the add-project form and on the assistant's confirmation card.
 */
export function GitInitSummary({ preview }: { preview: GitInitPreviewDTO }) {
  const isLargeTotal = preview.bytes >= GIT_INIT_LARGE_TOTAL_BYTES;
  return (
    <>
      <ol className={styles.list}>
        <li>{C.stepInit}</li>
        <li>{preview.gitignore === null ? C.stepKeepIgnore : C.stepIgnore(preview.gitignore.trim().split('\n'))}</li>
        <li>{C.stepCommit(preview.files, preview.bytes)}</li>
      </ol>
      <span className="hint">{C.identity}</span>
      {(isLargeTotal || preview.largeFileCount > 0) && (
        <div className="banner warn" role="status" data-testid="git-init-large">
          <Icon name="alert" />
          <div className="grow col">
            <strong>{C.largeTitle}</strong>
            {isLargeTotal && <span>{C.largeTotal}</span>}
            {preview.largeFileCount > 0 && (
              <>
                <span>{C.largeFiles(preview.largeFileCount)}</span>
                <ul className={styles.list}>
                  {preview.largeFiles.map((f) => (
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
    </>
  );
}
