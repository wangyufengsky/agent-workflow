import {
  closeUserTabOp,
  ErrorCode,
  navigateUserTabOp,
  openUserTabOp,
  type Preview,
  PreviewState,
  setUserViewportOp,
  startPreviewOp,
  stopPreviewOp,
  type TaskDetailDTO,
  type UserTabState,
  ViewportPreset,
} from '@aw/shared';
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { ApiError, callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Drawer } from '../../components/drawer.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { ExternalLink } from '../../components/external-link.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { PREVIEW_PANE_COPY as C } from '../../copy/browser.ts';
import { Segmented } from '../settings/setting-inputs.tsx';
import { useSettings } from '../settings/settings.queries.ts';
import { taskQuery } from '../tasks/tasks.queries.ts';
import { userTabLogsQuery } from './preview.queries.ts';
import styles from './preview-pane.module.css';
import { usePlacedTab } from './use-placed-tab.ts';

const limitSchema = z.object({ maxRunning: z.number(), taskIds: z.array(z.string()) });
/** The running previews when every one is in use (PREVIEW_LIMIT_REACHED, 29 §4.4); otherwise undefined. */
const limitOf = (error: unknown) =>
  error instanceof ApiError && error.code === ErrorCode.PreviewLimitReached
    ? limitSchema.parse(error.details)
    : undefined;

const pathOf = (url: string) => (url === '' ? '/' : `${new URL(url).pathname}${new URL(url).search}`);

/** One of the running previews in the way, and a way to stop it. */
function RunningPreview({ taskId, onStopped }: { taskId: string; onStopped: () => void }) {
  const task = useQuery(taskQuery(taskId));
  const stop = useMutation({ mutationFn: () => callOperation(stopPreviewOp, { taskId }), onSuccess: onStopped });
  return (
    <li className="row">
      <Link to={ROUTES.task} params={{ taskId }}>
        {task.data === undefined ? taskId : `${task.data.key} ${task.data.title}`}
      </Link>
      <Button size="sm" icon="stop" pending={stop.isPending} onClick={() => stop.mutate()}>
        {C.stopOne}
      </Button>
    </li>
  );
}

/** What fills the page area while there is no page to show (29 §8.1): the preview's state with its way on. */
function PreviewScreen({
  task,
  preview,
  error,
  onStart,
  starting,
}: {
  task: TaskDetailDTO;
  preview: Preview;
  error: unknown;
  onStart: () => void;
  starting: boolean;
}) {
  const idleMinutes = useSettings()['preview.idleMinutes'];
  const limit = limitOf(error);
  if (limit !== undefined) {
    return (
      <div className={styles.screen}>
        <p>{C.limit(limit.maxRunning)}</p>
        <ul className={styles.runningList}>
          {limit.taskIds.map((id) => (
            <RunningPreview key={id} taskId={id} onStopped={onStart} />
          ))}
        </ul>
      </div>
    );
  }
  if (error !== null) return <ErrorState error={error} onRetry={onStart} />;
  switch (preview.state) {
    case PreviewState.Stopped:
      return (
        <div className={styles.screen}>
          <p>{preview.logTail === '' ? C.stopped : C.idle(idleMinutes)}</p>
          {preview.logTail === '' && <p className="hint">{C.stoppedLede}</p>}
          <Button variant="primary" icon="play" pending={starting} onClick={onStart}>
            {preview.logTail === '' ? C.start : C.restartAfterIdle}
          </Button>
        </div>
      );
    case PreviewState.Starting:
      return (
        <div className={styles.screen}>
          <p>{C.starting}</p>
          <pre className={styles.log}>{preview.logTail}</pre>
        </div>
      );
    case PreviewState.Failed:
      return (
        <div className={styles.screen}>
          <p>{C.failed}</p>
          <pre className={styles.log}>{preview.logTail}</pre>
          <div className="row">
            <Button variant="primary" icon="refresh" pending={starting} onClick={onStart}>
              {C.retry}
            </Button>
            <Link className="btn secondary" to={ROUTES.project} params={{ projectId: task.project.id }}>
              {C.editSettings}
            </Link>
          </div>
        </div>
      );
    case PreviewState.Running:
      return null;
  }
}

/** The bottom bar's counts and their details (29 §8.1). */
function TabErrors({ tab }: { tab: UserTabState }) {
  const [open, setOpen] = useState(false);
  const logs = useQuery({ ...userTabLogsQuery(tab.tabId), enabled: open });
  return (
    <>
      <button
        type="button"
        className={tab.consoleErrors + tab.failedRequests > 0 ? `${styles.counts} ${styles.bad}` : styles.counts}
        onClick={() => setOpen(true)}
      >
        {C.counts(tab.consoleErrors, tab.failedRequests)}
      </button>
      <Drawer open={open} onOpenChange={setOpen} title={C.logsTitle}>
        {logs.data !== undefined && (
          <div className="col">
            <span className="label">{C.consoleErrors}</span>
            {logs.data.errors.length === 0 ? (
              <p className="hint">{C.noConsoleErrors}</p>
            ) : (
              <ul className={styles.logList}>
                {logs.data.errors.map((e, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: entries only grow and have no identity
                  <li key={i} className="mono">
                    {e.message}
                    {e.source !== null && <span className="hint"> · {e.source}</span>}
                  </li>
                ))}
              </ul>
            )}
            <span className="label">{C.failedRequests}</span>
            {logs.data.requests.length === 0 ? (
              <p className="hint">{C.noFailedRequests}</p>
            ) : (
              <ul className={styles.logList}>
                {logs.data.requests.map((r, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: entries only grow and have no identity
                  <li key={i} className="mono">
                    {r.method} {r.url} {r.status ?? r.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}

/**
 * 「我的预览」(29 §8.1): the user's own tab on the task's preview, placed over the page area while the pane is shown,
 * with the address bar, viewport and the bottom bar. It opens once the preview runs and closes with the task page.
 */
export function MyPreview({
  task,
  preview,
  active,
  pro,
}: {
  task: TaskDetailDTO;
  preview: Preview;
  active: boolean;
  pro: boolean;
}) {
  const qc = useQueryClient();
  const desktop = window.aw !== undefined;
  const area = useRef<HTMLDivElement>(null);
  const [tabId, setTabId] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  // Never fetched: its opening and `browser.tab_updated` write it.
  const tab = useQuery<UserTabState>({ queryKey: queryKeys.userTab(tabId ?? ''), queryFn: skipToken });
  const start = useMutation({ mutationFn: () => callOperation(startPreviewOp, { taskId: task.id }) });
  const open = useMutation({
    mutationFn: () => callOperation(openUserTabOp, { taskId: task.id }),
    onSuccess: (state) => {
      qc.setQueryData(queryKeys.userTab(state.tabId), state);
      setTabId(state.tabId);
    },
  });
  const running = preview.state === PreviewState.Running;
  const { mutate: openTab, isIdle: notOpened } = open;
  useEffect(() => {
    if (active && desktop && running && notOpened) openTab();
  }, [active, desktop, running, notOpened, openTab]);
  // The tab goes with the task page; on another page nobody would place it again.
  useEffect(
    () => () => {
      if (tabId !== null) void callOperation(closeUserTabOp, { tabId });
    },
    [tabId],
  );
  usePlacedTab(active && running ? tabId : null, area);

  const navigate = (path: string) => tabId !== null && void callOperation(navigateUserTabOp, { tabId, path });
  const restart = useMutation({
    mutationFn: async () => {
      await callOperation(stopPreviewOp, { taskId: task.id });
      await callOperation(startPreviewOp, { taskId: task.id });
      if (tabId !== null) await callOperation(navigateUserTabOp, { tabId, path: pathOf(tab.data?.url ?? '') });
    },
  });
  const startAgain = () => {
    start.reset();
    open.reset();
    start.mutate();
  };
  // A start that failed shows as the preview's own failed state, with its log.
  const error =
    [start.error, open.error].find(
      (e) => e !== null && !(e instanceof ApiError && e.code === ErrorCode.PreviewStartFailed),
    ) ?? null;
  const bridge = window.aw;
  const path = pathOf(tab.data?.url ?? '');

  return (
    <div className={styles.mine}>
      <div className={styles.toolbar}>
        {bridge !== undefined && tabId !== null && (
          <>
            <IconButton icon="chevLeft" label={C.back} onClick={() => bridge.browser.back(tabId)} />
            <IconButton icon="chevRight" label={C.forward} onClick={() => bridge.browser.forward(tabId)} />
            <IconButton icon="refresh" label={C.reload} onClick={() => bridge.browser.reload(tabId)} />
          </>
        )}
        <span className={styles.origin}>{C.origin(task.key)}</span>
        <input
          // A new page shows its own path; what is typed is kept until then.
          key={path}
          className={`input mono ${styles.address}`}
          aria-label={C.path}
          defaultValue={path}
          disabled={tabId === null}
          onKeyDown={(e) => {
            const value = e.currentTarget.value.trim();
            if (e.key === 'Enter' && value.startsWith('/')) navigate(value);
          }}
        />
        <Segmented
          label={C.viewport}
          value={tab.data?.viewport ?? ViewportPreset.Desktop}
          options={[ViewportPreset.Desktop, ViewportPreset.Tablet, ViewportPreset.Mobile].map((v) => ({
            value: v,
            label: C.viewports[v],
          }))}
          onChange={(preset) => tabId !== null && void callOperation(setUserViewportOp, { tabId, preset })}
        />
      </div>
      {running && !desktop ? (
        <div className={styles.screen}>
          <p>{C.desktopOnly}</p>
          {preview.url !== null && <ExternalLink href={`${preview.url}/`}>{C.openExternal}</ExternalLink>}
        </div>
      ) : running && error === null ? (
        // The user's tab is a native view placed over this area (29 §8.1).
        <div ref={area} className={styles.page} data-testid="preview-area" />
      ) : (
        <PreviewScreen
          task={task}
          preview={preview}
          error={error}
          onStart={startAgain}
          starting={start.isPending || open.isPending}
        />
      )}
      <div className={styles.bar}>
        <span className={styles.state} data-state={preview.state}>
          {C.state[preview.state]}
        </span>
        {tab.data !== undefined && running && <TabErrors tab={tab.data} />}
        {pro && (
          <span className={styles.barActions}>
            <Button size="sm" icon="terminal" onClick={() => setLogOpen(true)}>
              {C.serviceLog}
            </Button>
            {bridge !== undefined && tabId !== null && (
              <Button size="sm" icon="tool" onClick={() => bridge.browser.openDevTools(tabId)}>
                {C.devTools}
              </Button>
            )}
            {running && (
              <Button size="sm" icon="refresh" pending={restart.isPending} onClick={() => restart.mutate()}>
                {C.restart}
              </Button>
            )}
          </span>
        )}
      </div>
      <Drawer open={logOpen} onOpenChange={setLogOpen} title={C.serviceLog}>
        <pre className={styles.log}>{preview.logTail === '' ? C.serviceLogEmpty : preview.logTail}</pre>
      </Drawer>
    </div>
  );
}
