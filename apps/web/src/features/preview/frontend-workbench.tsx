import {
  type BrowserFrame,
  ChangeRequestReason,
  FRONTEND_ANNOTATION_LIMIT,
  FRONTEND_FEEDBACK_LIMIT,
  FRONTEND_NOTE_LIMIT,
  FRONTEND_VERIFY_PREFIX,
  type FrontendElement,
  type FrontendRound,
  NodeKind,
  NodeStatus,
  PreviewState,
  pickFrontendElementOp,
  previewPathFromUrl,
  type TaskDetailDTO,
  TaskStatus,
  type UserTabState,
  WorktreeStatus,
} from '@aw/shared';
import { skipToken, useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { PREVIEW_PANE_COPY } from '../../copy/browser.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { FRONTEND_COPY as C } from '../../copy/frontend.ts';
import { useUiStore } from '../../state/ui.store.ts';
import { useFinishFrontendTask, useRequestChanges } from '../tasks/tasks.queries.ts';
import { FollowedBrowserFrame } from './followed-browser-frame.tsx';
import { FrontendActivity } from './frontend-activity.tsx';
import styles from './frontend-workbench.module.css';
import { MyPreview } from './my-preview.tsx';
import { previewQuery, taskFileUrl, useImage, useStartPreview } from './preview.queries.ts';

type Panel = 'activity' | 'notes' | null;
type Draft = { element: FrontendElement; note: string };

function BeforeImage({ taskId, before }: { taskId: string; before: NonNullable<FrontendRound['before']> }) {
  const src = useImage(taskFileUrl(taskId, before.file));
  return src === null ? null : <img src={src} alt={C.screenshotAlt(before.path)} />;
}

export function FrontendRoundHistory({ task, onOpen }: { task: TaskDetailDTO; onOpen: (nodeId: string) => void }) {
  const rounds = task.frontend?.rounds ?? [];
  if (rounds.length === 0) return null;
  return (
    <section className={styles.history} aria-label={C.history}>
      <h3>{C.history}</h3>
      <ol>
        {[...rounds].reverse().map((round, i) => {
          const node = task.nodes.find((item) => item.id === round.nodeId);
          const title = node?.title ?? `#${rounds.length - i}`;
          return (
            <li key={round.nodeId}>
              <button type="button" className="btn ghost sm" onClick={() => onOpen(round.nodeId)}>
                {title}
              </button>
              <p>{round.feedback}</p>
              {round.annotations.map(({ element, note }) => (
                <p key={element.id} className="hint">
                  {element.label || C.element(element.tag)} · {element.path} · {note}
                </p>
              ))}
              {round.before !== null && (
                <details>
                  <summary>
                    {C.before} · {round.before.path} · {PREVIEW_PANE_COPY.viewports[round.before.viewport]}
                  </summary>
                  <BeforeImage taskId={task.id} before={round.before} />
                </details>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function FrontendWorkbench({
  task,
  pro,
  hasConfiguredPreview,
  frame,
  active,
  delivery,
  onOpenNode,
  nodeDetails,
}: {
  task: TaskDetailDTO;
  pro: boolean;
  hasConfiguredPreview: boolean;
  frame?: BrowserFrame | undefined;
  active: boolean;
  delivery: ReactNode;
  onOpenNode: (id: string) => void;
  nodeDetails?: { title: string; content: ReactNode; onClose: () => void } | undefined;
}) {
  const [pickedPanel, setPanel] = useState<Panel>();
  const activityId = useId();
  const openActivity = useRef<HTMLButtonElement>(null);
  const [feedback, setFeedback] = useState('');
  const [notes, setNotes] = useState<Draft[]>([]);
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<unknown>(null);
  const pick = useRef<{ tabId: string; requestId: string } | null>(null);
  const tabId = useUiStore((s) => s.previewTabs[task.id]);
  const tab = useQuery<UserTabState>({ queryKey: queryKeys.userTab(tabId ?? ''), queryFn: skipToken }).data;
  const showAssistant = useUiStore((s) => s.setAssistantOpen);
  const hasDraft = feedback.trim() !== '' || notes.length > 0;
  const revision = useRequestChanges();
  const finish = useFinishFrontendTask();
  const preview = useQuery(previewQuery(task.id));
  const start = useStartPreview(task.id);
  const { mutate: startPreview } = start;
  const attemptedStart = useRef(false);
  const previewState = preview.data?.state;
  const firstResult = task.nodes.some((node) => node.status === NodeStatus.Done);
  const worktreeReady = task.git.worktreeStatus === WorktreeStatus.Ready;
  const review = task.status === TaskStatus.Review;
  const working = task.status === TaskStatus.Running;
  const autoStart = worktreeReady && (firstResult || (hasConfiguredPreview && working));
  const live = previewState === PreviewState.Running;
  const failed = previewState === PreviewState.Failed;
  const showFrame = frame !== undefined && pickedPanel !== 'notes';
  const activityInMain = !showFrame && !live && !failed && !firstResult;
  const defaultPanel = pickedPanel === undefined ? (activityInMain ? null : 'activity') : pickedPanel;
  const panel = nodeDetails === undefined ? defaultPanel : 'node';
  const checking =
    working && task.nodes.findLast((node) => node.kind !== NodeKind.Verify)?.key.startsWith(FRONTEND_VERIFY_PREFIX);
  const canPick = tabId !== undefined && notes.length < FRONTEND_ANNOTATION_LIMIT;
  const verified = task.frontend?.verified === true;
  const status =
    verified && review
      ? C.verified
      : checking
        ? C.checking
        : live
          ? C.livePreview
          : failed
            ? C.failedPreview
            : previewState === PreviewState.Starting
              ? C.startingPreview
              : activityInMain
                ? C.waiting
                : PREVIEW_PANE_COPY.state[PreviewState.Stopped];

  useEffect(() => {
    if (attemptedStart.current || previewState === undefined) return;
    if (previewState !== PreviewState.Stopped) {
      attemptedStart.current = true;
      return;
    }
    if (autoStart) {
      attemptedStart.current = true;
      startPreview();
    }
  }, [autoStart, previewState, startPreview]);

  useEffect(
    () => () => {
      const active = pick.current;
      if (active === null) return;
      pick.current = null;
      void callOperation(pickFrontendElementOp, { ...active, cancel: true }).catch(() => undefined);
    },
    [],
  );

  async function beginPick() {
    if (tabId === undefined || pick.current !== null || !canPick) return;
    const request = { tabId, requestId: crypto.randomUUID() };
    pick.current = request;
    setPicking(true);
    setPickError(null);
    try {
      const { element } = await callOperation(pickFrontendElementOp, request);
      if (pick.current !== request || element === null) return;
      setNotes((items) => [...items, { element, note: '' }]);
    } catch (err) {
      if (pick.current === request) setPickError(err);
    } finally {
      if (pick.current === request) {
        pick.current = null;
        setPicking(false);
      }
    }
  }

  function cancelPick() {
    const active = pick.current;
    if (active === null) return;
    void callOperation(pickFrontendElementOp, { ...active, cancel: true }).catch(setPickError);
  }

  function toggle(next: Exclude<Panel, null>) {
    nodeDetails?.onClose();
    if (panel === next) {
      cancelPick();
      setPanel(null);
    } else {
      setPanel(next);
      if (next === 'notes') void beginPick();
      else cancelPick();
    }
  }

  function revise() {
    if (!review || !hasDraft || notes.some((item) => item.note.trim() === '')) return;
    revision.mutate(
      {
        id: task.id,
        reason: ChangeRequestReason.User,
        feedback: feedback.trim() || C.annotationFeedback,
        ...(tabId === undefined
          ? {}
          : {
              page: {
                tabId,
                annotations: notes.map(({ element, note }) => ({ elementId: element.id, note })),
              },
            }),
      },
      {
        onSuccess: () => {
          setNotes([]);
          setFeedback('');
          setPanel('activity');
        },
      },
    );
  }

  return (
    <section className={styles.workbench} data-testid="frontend-workbench" aria-label={C.preview}>
      <header className={styles.toolbar}>
        <div className={styles.status}>
          <strong>{C.preview}</strong>
          <span className={styles.previewState} data-live={live} aria-live="polite">
            {status}
          </span>
        </div>
        {!showFrame && tabId !== undefined && (
          <Button variant="ghost" size="sm" icon="sparkle" onClick={() => showAssistant(true)}>
            {C.assistant}
          </Button>
        )}
        {!activityInMain && (
          <button
            type="button"
            ref={openActivity}
            className={`btn sm ${panel === 'activity' ? 'secondary' : 'ghost'}`}
            aria-controls={activityId}
            aria-expanded={panel === 'activity'}
            onClick={() => toggle('activity')}
          >
            <Icon name="gauge" size="sm" />
            {C.activity}
          </button>
        )}
        <Button
          variant={panel === 'notes' ? 'primary' : 'secondary'}
          size="sm"
          icon="edit"
          aria-expanded={panel === 'notes'}
          disabled={activityInMain}
          onClick={() => toggle('notes')}
        >
          {C.mark}
        </Button>
        {delivery}
        {!verified && (
          <Button
            variant="primary"
            size="sm"
            icon="check"
            disabled={!review || hasDraft || revision.isPending}
            pending={finish.isPending}
            onClick={() => {
              const path =
                tab !== undefined && URL.canParse(tab.url) ? previewPathFromUrl(new URL(tab.url)) : undefined;
              finish.mutate(
                { id: task.id, ...(path === undefined ? {} : { path }) },
                {
                  onSuccess: () => {
                    nodeDetails?.onClose();
                    setPanel('activity');
                  },
                },
              );
            }}
          >
            {C.finish}
          </Button>
        )}
      </header>
      {finish.isError && <ErrorState error={finish.error} />}
      {start.isError && previewState === PreviewState.Stopped && (
        <ErrorState error={start.error} onRetry={() => startPreview()} />
      )}
      <div className={styles.body}>
        {!activityInMain && (
          <div className={styles.preview}>
            {showFrame && <FollowedBrowserFrame frame={frame} />}
            {preview.data !== undefined && worktreeReady ? (
              <div hidden={showFrame} className={styles.personalPreview}>
                <MyPreview task={task} preview={preview.data} active={active && !showFrame} pro={pro} />
              </div>
            ) : preview.isError ? (
              <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />
            ) : null}
          </div>
        )}
        <section
          id={activityId}
          aria-label={C.activity}
          className={activityInMain ? styles.activityMain : styles.inspector}
          hidden={!activityInMain && panel !== 'activity'}
        >
          {!activityInMain && (
            <div className={styles.inspectorHead}>
              <h2>{C.activity}</h2>
              <IconButton
                icon="x"
                label={C.closeActivity}
                onClick={() => {
                  toggle('activity');
                  openActivity.current?.focus();
                }}
              />
            </div>
          )}
          <FrontendActivity task={task} inMain={activityInMain} starting={previewState === PreviewState.Starting} />
          {!activityInMain && panel === 'activity' && <FrontendRoundHistory task={task} onOpen={onOpenNode} />}
          {activityInMain && preview.isError && (
            <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />
          )}
        </section>
        {nodeDetails !== undefined && (
          // This is placed beside the native preview so both surfaces stay visible.
          <aside className={styles.inspector} aria-label={nodeDetails.title}>
            <div className={styles.inspectorHead}>
              <h2>{nodeDetails.title}</h2>
              <IconButton icon="x" label={COMMON_COPY.close} onClick={nodeDetails.onClose} />
            </div>
            {nodeDetails.content}
          </aside>
        )}
        {panel === 'notes' && (
          <aside className={styles.inspector} aria-label={C.notes}>
            <div className={styles.inspectorHead}>
              <h2>{C.notes}</h2>
              <IconButton icon="x" label={C.close} onClick={() => toggle('notes')} />
            </div>
            {picking ? (
              <>
                <p className="hint" role="status">
                  {C.pickHint}
                </p>
                <Button size="sm" onClick={cancelPick}>
                  {C.cancelPick}
                </Button>
              </>
            ) : (
              <Button size="sm" icon="target" disabled={!canPick} onClick={() => void beginPick()}>
                {C.pick}
              </Button>
            )}
            {tabId === undefined && <p className="hint">{C.desktopPick}</p>}
            {pickError !== null && <ErrorState error={pickError} />}
            {notes.map(({ element, note }) => {
              const label = element.label || C.element(element.tag);
              return (
                <div className={styles.note} key={element.id}>
                  <div className={styles.inspectorHead}>
                    <strong>{label}</strong>
                    <IconButton
                      icon="x"
                      label={C.removeNote(label)}
                      onClick={() => setNotes((items) => items.filter((item) => item.element.id !== element.id))}
                    />
                  </div>
                  <small>
                    {element.path} · {element.layout.width}×{element.layout.height}
                  </small>
                  <textarea
                    className="input"
                    rows={2}
                    aria-label={C.noteFor(label)}
                    placeholder={C.noteHint}
                    value={note}
                    maxLength={FRONTEND_NOTE_LIMIT}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setNotes((items) =>
                        items.map((item) => (item.element.id === element.id ? { ...item, note: value } : item)),
                      );
                    }}
                  />
                </div>
              );
            })}
            <textarea
              className="input"
              rows={3}
              aria-label={C.notesHint}
              placeholder={C.notesHint}
              value={feedback}
              maxLength={FRONTEND_FEEDBACK_LIMIT}
              onChange={(event) => setFeedback(event.target.value)}
            />
            {revision.isError && <ErrorState error={revision.error} />}
            <Button
              variant="primary"
              icon="sparkle"
              onClick={revise}
              pending={revision.isPending}
              disabled={
                !review ||
                !hasDraft ||
                picking ||
                (tabId === undefined && notes.length > 0) ||
                notes.some((item) => item.note.trim() === '')
              }
            >
              {C.submit}
            </Button>
          </aside>
        )}
      </div>
    </section>
  );
}
