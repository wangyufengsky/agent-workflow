import { AcceptanceCheckKind, AttemptStatus, type BrowserFrame, type TaskDetailDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PREVIEW_PANE_COPY as C } from '../../copy/browser.ts';
import { nodeQuery } from '../tasks/tasks.queries.ts';
import { MyPreview } from './my-preview.tsx';
import {
  attemptFileUrl,
  framesQuery,
  previewQuery,
  previewSessionsQuery,
  taskFileUrl,
  useImage,
} from './preview.queries.ts';
import styles from './preview-pane.module.css';

type Session = { kind: 'mine' } | { kind: 'attempt'; attemptId: string } | { kind: 'check'; nodeId: string };
const ACTIVE: readonly AttemptStatus[] = [AttemptStatus.Starting, AttemptStatus.Running];

const frameLabel = (frame: BrowserFrame) =>
  `${C.tool[frame.tool] ?? frame.tool} ${frame.url === '' ? '' : new URL(frame.url).pathname}`;

function Image({ url, alt }: { url: string; alt: string }) {
  const src = useImage(url);
  return src === null ? <div className={styles.imagePending} /> : <img src={src} alt={alt} />;
}

/**
 * An AI session's frames (29 §8.2): the latest one, followed as new frames arrive, until the user picks an earlier
 * one; then「回到最新」.
 */
function FramesViewer({ attemptId }: { attemptId: string }) {
  const frames = useQuery(framesQuery(attemptId));
  const [picked, setPicked] = useState<number | null>(null);
  const list = frames.data ?? [];
  const latest = list.at(-1);
  const shown = picked === null ? latest : list.find((f) => f.seq === picked);
  if (shown === undefined) return <p className={styles.screen}>{C.noFrames}</p>;
  return (
    <div className={styles.frames}>
      <div className={styles.frameHead}>
        <span>{frameLabel(shown)}</span>
        {shown !== latest && (
          <button type="button" className="btn secondary sm" onClick={() => setPicked(null)}>
            {C.latest}
          </button>
        )}
      </div>
      <div className={styles.frame}>
        <Image url={attemptFileUrl(attemptId, shown.file)} alt={frameLabel(shown)} />
      </div>
      <ol className={styles.frameList} aria-label={C.frames}>
        {list.map((f) => (
          <li key={f.seq}>
            <button type="button" aria-current={f === shown} onClick={() => setPicked(f === latest ? null : f.seq)}>
              {f.seq}. {frameLabel(f)}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A step's last page check: every page at every viewport with its screenshot (29 §7.4). */
function CheckShots({ taskId, nodeId }: { taskId: string; nodeId: string }) {
  const node = useQuery(nodeQuery(taskId, nodeId));
  const check = node.data?.checkResults?.find((c) => c.kind === AcceptanceCheckKind.Browser);
  if (check === undefined || check.kind !== AcceptanceCheckKind.Browser) return null;
  return (
    <div className={styles.shots}>
      {check.pages.length === 0 && <p className="hint">{C.noShots}</p>}
      {check.pages.map((p) => (
        <figure key={`${p.path}-${p.viewport}`} className={styles.shot}>
          {p.screenshot !== null && <Image url={taskFileUrl(taskId, p.screenshot)} alt={`${p.path} · ${p.viewport}`} />}
          <figcaption>
            <span className="mono">{p.path}</span> · {C.viewports[p.viewport]} ·{' '}
            {p.errors.length === 0 ? C.passed : `${C.notPassed}（${C.errors(p.errors.length)}）`}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/**
 * The task page's「预览」tab (29 §8.1): the user's own preview, or what an AI session or a page check saw. Kept
 * mounted while the progress tab shows, so the user's tab survives switching; `active` places it.
 */
export function PreviewPane({ task, active, pro }: { task: TaskDetailDTO; active: boolean; pro: boolean }) {
  const preview = useQuery(previewQuery(task.id));
  const sessions = useQuery(previewSessionsQuery(task.id));
  const [session, setSession] = useState<Session>({ kind: 'mine' });
  const titleOf = (nodeId: string | null) => task.nodes.find((n) => n.id === nodeId)?.title ?? task.title;
  const value =
    session.kind === 'mine' ? 'mine' : session.kind === 'attempt' ? `a:${session.attemptId}` : `c:${session.nodeId}`;

  return (
    <div className={styles.pane} data-testid="preview-pane">
      <select
        className={`input ${styles.session}`}
        aria-label={C.session}
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          setSession(
            v === 'mine'
              ? { kind: 'mine' }
              : v.startsWith('a:')
                ? { kind: 'attempt', attemptId: v.slice(2) }
                : { kind: 'check', nodeId: v.slice(2) },
          );
        }}
      >
        <option value="mine">{C.mine}</option>
        {sessions.data?.attempts.map((a) => (
          <option key={a.attemptId} value={`a:${a.attemptId}`}>
            {C.aiSession(titleOf(a.nodeId), ACTIVE.includes(a.status))}
          </option>
        ))}
        {sessions.data?.checks.map((c) => (
          <option key={c.nodeId} value={`c:${c.nodeId}`}>
            {C.checkSession(titleOf(c.nodeId))}
          </option>
        ))}
      </select>
      {preview.data !== undefined && (
        // Kept while another session shows: the user's tab stays open, only off the window.
        <div hidden={session.kind !== 'mine'} className={styles.fill}>
          <MyPreview task={task} preview={preview.data} active={active && session.kind === 'mine'} pro={pro} />
        </div>
      )}
      {session.kind === 'attempt' && <FramesViewer attemptId={session.attemptId} />}
      {session.kind === 'check' && <CheckShots taskId={task.id} nodeId={session.nodeId} />}
    </div>
  );
}
