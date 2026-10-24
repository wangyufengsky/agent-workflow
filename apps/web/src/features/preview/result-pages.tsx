import { AcceptanceCheckKind, type TaskDetailDTO, TaskStatus, ViewportPreset, WorktreeStatus } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { PAGE_CHECK_COPY as C } from '../../copy/browser.ts';
import { projectQuery } from '../projects/projects.queries.ts';
import { nodeQuery } from '../tasks/tasks.queries.ts';
import styles from './page-check-result.module.css';
import { PageShot } from './page-check-result.tsx';
import { previewSessionsQuery } from './preview.queries.ts';

/** Screenshots shown before the rest fold (29 §8.4). */
const SHOWN = 4;

/**
 * The result card's「页面」(29 §8.4): the last page check's desktop screenshots, and「打开预览」while the task's
 * preview can still run. Nothing when the project has no preview.
 */
export function ResultPages({ task }: { task: TaskDetailDTO }) {
  const project = useQuery(projectQuery(task.project.id));
  const hasPreview = project.data !== undefined && project.data.preview !== null;
  const sessions = useQuery({ ...previewSessionsQuery(task.id), enabled: hasPreview });
  const last = sessions.data?.checks.at(-1);
  const node = useQuery({ ...nodeQuery(task.id, last?.nodeId ?? ''), enabled: last !== undefined });
  if (!hasPreview) return null;
  const check = node.data?.checkResults?.find((c) => c.kind === AcceptanceCheckKind.Browser);
  const shots = (check?.kind === AcceptanceCheckKind.Browser ? check.pages : []).flatMap((p) =>
    p.viewport === ViewportPreset.Desktop && p.screenshot !== null ? [{ ...p, screenshot: p.screenshot }] : [],
  );
  const canOpen =
    task.git.worktreeStatus === WorktreeStatus.Ready &&
    task.status !== TaskStatus.Completed &&
    task.status !== TaskStatus.Cancelled;
  const shot = (p: (typeof shots)[number]) => (
    <figure key={p.path} className={styles.resultShot}>
      <PageShot taskId={task.id} page={p} />
      <figcaption className="mono">{p.path}</figcaption>
    </figure>
  );
  return (
    <section className="col" data-testid="result-pages">
      <div className="row">
        <h3 className="sec-t grow">{C.section}</h3>
        {canOpen && (
          <Link className="btn ghost sm" to={ROUTES.task} params={{ taskId: task.id }} search={{ view: 'preview' }}>
            {C.openPreview}
          </Link>
        )}
      </div>
      {shots.length > 0 && <div className={styles.resultShots}>{shots.slice(0, SHOWN).map(shot)}</div>}
      {shots.length > SHOWN && (
        <details>
          <summary className="hint">{C.morePages(shots.length - SHOWN)}</summary>
          <div className={styles.resultShots}>{shots.slice(SHOWN).map(shot)}</div>
        </details>
      )}
    </section>
  );
}
