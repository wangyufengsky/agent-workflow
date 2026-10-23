import {
  getPreviewOp,
  navigatePreviewTabOp,
  openPreviewTabOp,
  PreviewState,
  setPreviewViewportOp,
  stopPreviewOp,
  type TaskDetailDTO,
  ViewportPreset,
  viewportPresetSchema,
  WorktreeStatus,
} from '@aw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { TASK_PREVIEW_COPY as C } from '../../copy/browser.ts';
import { useUiStore } from '../../state/ui.store.ts';
import styles from './task-preview.module.css';
import { usePlacedPreview } from './use-placed-preview.ts';

function PreviewPage({
  tabId,
  taskId,
  initialViewport,
}: {
  tabId: string;
  taskId: string;
  initialViewport: ViewportPreset;
}) {
  const area = useRef<HTMLElement>(null);
  const [path, setPath] = useState('/');
  const [preset, setPreset] = useState<ViewportPreset>(initialViewport);
  usePlacedPreview(tabId, area);
  useEffect(() => {
    useUiStore.getState().setActivePreview({ taskId, tabId });
    return () => useUiStore.getState().setActivePreview(null);
  }, [taskId, tabId]);
  const navigate = useMutation({ mutationFn: () => callOperation(navigatePreviewTabOp, { tabId, path }) });
  const viewport = useMutation({
    mutationFn: (next: ViewportPreset) => callOperation(setPreviewViewportOp, { tabId, preset: next }),
    onSuccess: (_result, next) => setPreset(next),
  });
  return (
    <div className="col">
      <div className={styles.toolbar}>
        <span className="label">{C.mine}</span>
        <Button size="sm" onClick={() => window.aw?.browser.back(tabId)}>
          {C.back}
        </Button>
        <Button size="sm" onClick={() => window.aw?.browser.forward(tabId)}>
          {C.forward}
        </Button>
        <Button size="sm" onClick={() => window.aw?.browser.reload(tabId)}>
          {C.reload}
        </Button>
        <form
          className={styles.address}
          onSubmit={(event) => {
            event.preventDefault();
            navigate.mutate();
          }}
        >
          <input
            className="input mono grow"
            aria-label={C.path}
            value={path}
            onChange={(event) => setPath(event.target.value)}
          />
          <Button type="submit" size="sm" pending={navigate.isPending}>
            {C.go}
          </Button>
        </form>
        <select
          className={`input ${styles.viewport}`}
          aria-label={C.viewport}
          value={preset}
          disabled={viewport.isPending}
          onChange={(event) => viewport.mutate(viewportPresetSchema.parse(event.target.value))}
        >
          {Object.values(ViewportPreset).map((value) => (
            <option key={value} value={value}>
              {C.presets[value]}
            </option>
          ))}
        </select>
      </div>
      {navigate.isError && <ErrorState error={navigate.error} />}
      {viewport.isError && <ErrorState error={viewport.error} />}
      <section className={styles.area} ref={area} data-testid="user-preview-area" aria-label={C.mine} />
      <p className="hint">{C.assistantHint}</p>
    </div>
  );
}

/** 桌面版拥有真实用户页签；普通浏览器不冒充用户页签，也不自动打开 AI 会话。 */
export function TaskPreview({ task }: { task: TaskDetailDTO }) {
  const qc = useQueryClient();
  const preview = useQuery({
    queryKey: queryKeys.preview(task.id),
    queryFn: () => callOperation(getPreviewOp, { taskId: task.id }),
  });
  const open = useMutation({ mutationFn: () => callOperation(openPreviewTabOp, { taskId: task.id }) });
  const { reset } = open;
  useEffect(() => {
    // 助手或其他界面也可以停服务；重启后仍需用户自己重新打开，不能恢复旧关联。
    if (preview.data?.state === PreviewState.Stopped || preview.data?.state === PreviewState.Failed) reset();
  }, [preview.data?.state, reset]);
  const stop = useMutation({
    mutationFn: () => callOperation(stopPreviewOp, { taskId: task.id }),
    onSuccess: (state) => {
      qc.setQueryData(queryKeys.preview(task.id), state);
      open.reset();
    },
  });
  if (window.aw === undefined) return <p className="hint">{C.desktopOnly}</p>;
  const running = preview.data?.state === PreviewState.Running;
  return (
    <section className="col" aria-label={C.title}>
      <div className="row">
        <Button
          variant="primary"
          pending={open.isPending}
          disabled={task.git.worktreeStatus !== WorktreeStatus.Ready}
          onClick={() => open.mutate()}
        >
          {open.data === undefined ? C.open : C.reopen}
        </Button>
        {running && (
          <Button pending={stop.isPending} onClick={() => stop.mutate()}>
            {C.stop}
          </Button>
        )}
      </div>
      {task.git.worktreeStatus !== WorktreeStatus.Ready && <p className="hint">{C.noWorktree}</p>}
      {open.isError && <ErrorState error={open.error} />}
      {stop.isError && <ErrorState error={stop.error} />}
      {preview.isError && <ErrorState error={preview.error} />}
      {running && open.data !== undefined && (
        <PreviewPage tabId={open.data.tabId} taskId={task.id} initialViewport={open.data.viewport} />
      )}
      {preview.data !== undefined && preview.data.logTail !== '' && (
        <details>
          <summary>{C.logs}</summary>
          <pre className={styles.logs}>{preview.data.logTail}</pre>
        </details>
      )}
    </section>
  );
}
