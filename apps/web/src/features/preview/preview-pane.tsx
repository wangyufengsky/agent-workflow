import {
  ACTIVE_ATTEMPT_STATUSES,
  AcceptanceCheckKind,
  BROWSER_WATCH_ZOOMS,
  type BrowserFrame,
  type BrowserWatchZoom,
  browserWatchZoomSchema,
  captureBrowserTestOp,
  type TaskDetailDTO,
  TaskStatus,
  VIEWPORT_SIZES,
} from '@aw/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef, useState, useSyncExternalStore } from 'react';
import { callOperation } from '../../api/client.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { PREVIEW_PANE_COPY as C } from '../../copy/browser.ts';
import { BROWSER_TEST_COPY } from '../../copy/tasks.ts';
import { BrowserCaseHandoffPane } from '../browser-cases/browser-case-handoff.tsx';
import { BrowserCaseReport, StepScreenshot } from '../browser-cases/browser-case-report.tsx';
import { nodeQuery } from '../tasks/tasks.queries.ts';
import { BrowserTestHistory } from './browser-test-history.tsx';
import testStyles from './browser-test-pane.module.css';
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
import { usePlacedTab } from './use-placed-tab.ts';

type Session = { kind: 'mine' } | { kind: 'attempt'; attemptId: string } | { kind: 'check'; nodeId: string };

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

const narrowWindow = () => window.matchMedia('(max-width: 1040px)');
function subscribeToWindowWidth(onChange: () => void): () => void {
  const media = narrowWindow();
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/** 实时网页占用剩余空间，记录只在自己的面板滚动。 */
export function BrowserTestPane({ task, active }: { task: TaskDetailDTO; active: boolean }) {
  const { data, error } = useQuery(previewSessionsQuery(task.id));
  const [selected, setSelected] = useState('');
  const [watchZoom, setWatchZoom] = useState<{ tabId: string; zoom: BrowserWatchZoom }>();
  const [focused, setFocused] = useState(false);
  const [narrowHistory, setNarrowHistory] = useState(false);
  const narrow = useSyncExternalStore(subscribeToWindowWidth, () => narrowWindow().matches);
  const area = useRef<HTMLDivElement>(null);
  const attempts = data?.attempts ?? [];
  const attempt = attempts.find((item) => item.attemptId === selected) ?? attempts.at(-1);
  const live = data?.testTab?.attemptId === attempt?.attemptId ? data?.testTab : undefined;
  const handoff = live !== undefined ? task.browserCaseHandoff : undefined;
  const zoom = watchZoom?.tabId === live?.tabId ? (watchZoom?.zoom ?? 1) : 1;
  const changeZoom = (tabId: string, next: BrowserWatchZoom) => {
    window.aw?.browser.setWatchZoom(tabId, next);
    setWatchZoom({ tabId, zoom: next });
  };
  const showRecords = narrow ? narrowHistory && handoff === undefined : !focused;
  const showPreview = !narrow || !showRecords;
  const report = task.result?.browserCaseReport;
  const running = task.status === TaskStatus.Running || task.status === TaskStatus.Paused;
  const origin = task.browserTest?.target.startsWith('/') === false ? new URL(task.browserTest.target).origin : '';
  const viewport = live === undefined ? undefined : VIEWPORT_SIZES[live.viewport];
  usePlacedTab(active && showPreview ? (live?.tabId ?? null) : null, area);
  const capture = useMutation({
    mutationFn: (attemptId: string) => callOperation(captureBrowserTestOp, { taskId: task.id, attemptId }),
  });
  return (
    <div className={testStyles.workspace} data-split={showPreview && showRecords} data-testid="browser-test-workspace">
      {showPreview && (
        <section className={testStyles.preview} aria-label={BROWSER_TEST_COPY.browser}>
          <div className={testStyles.toolbar}>
            {live !== undefined && handoff === undefined && (
              <strong className={testStyles.watching}>{BROWSER_TEST_COPY.watching}</strong>
            )}
            <span className={`mono ${testStyles.address}`} title={origin + (live?.path ?? '')}>
              {origin}
              {live?.path}
            </span>
            {live !== undefined && handoff === undefined && window.aw !== undefined && (
              <Button size="sm" pending={capture.isPending} onClick={() => capture.mutate(live.attemptId)}>
                {BROWSER_TEST_COPY.capture}
              </Button>
            )}
            {narrow && handoff === undefined && (
              <Button size="sm" icon="list" onClick={() => setNarrowHistory(true)}>
                {BROWSER_TEST_COPY.records}
              </Button>
            )}
            {!narrow && (
              <Button size="sm" icon={focused ? 'list' : 'expand'} onClick={() => setFocused(!focused)}>
                {focused ? BROWSER_TEST_COPY.records : BROWSER_TEST_COPY.focus}
              </Button>
            )}
          </div>
          {error !== null && <ErrorState error={error} />}
          {capture.isError && <ErrorState error={capture.error} />}
          {handoff !== undefined && (
            <div className={testStyles.handoff}>
              <BrowserCaseHandoffPane taskId={task.id} handoff={handoff} />
            </div>
          )}
          {live !== undefined && window.aw !== undefined ? (
            <div
              ref={area}
              className={testStyles.surface}
              data-testid={handoff?.active === true ? 'case-handoff-surface' : 'browser-test-surface'}
            />
          ) : (
            <div className={testStyles.previewBody}>
              <p className="hint">
                {live !== undefined
                  ? BROWSER_TEST_COPY.desktopOnly
                  : running
                    ? BROWSER_TEST_COPY.waitingPage
                    : BROWSER_TEST_COPY.finishedPage}
              </p>
              {attempt !== undefined && attempt.frames > 0 && live === undefined && (
                <FramesViewer key={attempt.attemptId} attemptId={attempt.attemptId} />
              )}
              {task.browserCase !== undefined && report !== undefined && (
                <BrowserCaseReport test={task.browserCase} report={report} />
              )}
            </div>
          )}
          {viewport !== undefined && (
            <div className={testStyles.statusBar}>
              {live !== undefined && handoff === undefined && window.aw !== undefined && (
                <>
                  <select
                    className={`input ${testStyles.zoom}`}
                    aria-label={BROWSER_TEST_COPY.zoom}
                    value={String(zoom)}
                    onChange={(event) => {
                      const value = event.target.value;
                      const next = browserWatchZoomSchema.safeParse(value === 'fit' ? value : Number(value));
                      if (next.success) changeZoom(live.tabId, next.data);
                    }}
                  >
                    <option value="fit">{BROWSER_TEST_COPY.zoomFit}</option>
                    {BROWSER_WATCH_ZOOMS.map((scale) => (
                      <option key={scale} value={scale}>
                        {scale * 100}%
                      </option>
                    ))}
                  </select>
                  <Button size="sm" onClick={() => changeZoom(live.tabId, 1)}>
                    {BROWSER_TEST_COPY.resetView}
                  </Button>
                  <span className={testStyles.panHint}>{BROWSER_TEST_COPY.panHint}</span>
                </>
              )}
              <span className="mono">
                {viewport.width} × {viewport.height}
              </span>
            </div>
          )}
        </section>
      )}
      {showRecords && (
        <aside className={testStyles.records} aria-label={BROWSER_TEST_COPY.actions}>
          <header className={testStyles.recordsHead}>
            <h2>{BROWSER_TEST_COPY.actions}</h2>
            <Button
              size="sm"
              variant="ghost"
              icon={narrow ? 'chevLeft' : 'x'}
              aria-label={narrow ? BROWSER_TEST_COPY.backToBrowser : BROWSER_TEST_COPY.hideRecords}
              title={narrow ? BROWSER_TEST_COPY.backToBrowser : BROWSER_TEST_COPY.hideRecords}
              onClick={() => (narrow ? setNarrowHistory(false) : setFocused(true))}
            />
          </header>
          {attempts.length > 1 && (
            <select
              className={`input ${testStyles.attempt}`}
              aria-label={C.session}
              value={attempt?.attemptId ?? ''}
              onChange={(event) => setSelected(event.target.value)}
            >
              {attempts.map((item, index) => (
                <option key={item.attemptId} value={item.attemptId}>
                  {BROWSER_TEST_COPY.attempt(index + 1)}
                </option>
              ))}
            </select>
          )}
          {attempt !== undefined ? (
            <BrowserTestHistory key={attempt.attemptId} attemptId={attempt.attemptId} />
          ) : (
            <div className={testStyles.empty}>
              <p className="hint">{BROWSER_TEST_COPY.noActions}</p>
            </div>
          )}
          {attempt !== undefined && attempt.screenshots.length > 0 && (
            <details className={testStyles.screenshots}>
              <summary>{BROWSER_TEST_COPY.screenshots}</summary>
              {attempt.screenshots.map((file) => (
                <StepScreenshot key={file} attemptId={attempt.attemptId} file={file} />
              ))}
            </details>
          )}
        </aside>
      )}
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
            {C.aiSession(titleOf(a.nodeId), ACTIVE_ATTEMPT_STATUSES.includes(a.status))}
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
