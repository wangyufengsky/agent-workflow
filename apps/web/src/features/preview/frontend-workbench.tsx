import {
  ChangeRequestReason,
  FRONTEND_ANNOTATION_LIMIT,
  FRONTEND_FEEDBACK_LIMIT,
  FRONTEND_NOTE_LIMIT,
  FRONTEND_VERIFY_PREFIX,
  type FrontendElement,
  type FrontendRound,
  NodeKind,
  NodeStatus,
  pickFrontendElementOp,
  previewPathFromUrl,
  type TaskDetailDTO,
  TaskStatus,
  type UserTabState,
  WorktreeStatus,
} from '@aw/shared';
import { skipToken, useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { PREVIEW_PANE_COPY } from '../../copy/browser.ts';
import { FRONTEND_COPY as C } from '../../copy/frontend.ts';
import { useUiStore } from '../../state/ui.store.ts';
import { useFinishFrontendTask, useRequestChanges } from '../tasks/tasks.queries.ts';
import styles from './frontend-workbench.module.css';
import { MyPreview } from './my-preview.tsx';
import { previewQuery, taskFileUrl, useImage } from './preview.queries.ts';

type Panel = 'notes' | 'progress' | null;
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
  progress,
  onOpenNode,
}: {
  task: TaskDetailDTO;
  pro: boolean;
  hasConfiguredPreview: boolean;
  progress: ReactNode;
  onOpenNode: (id: string) => void;
}) {
  const [panel, setPanel] = useState<Panel>(null);
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
  const firstResult = task.nodes.some((node) => node.status === NodeStatus.Done);
  const ready = task.git.worktreeStatus === WorktreeStatus.Ready && (hasConfiguredPreview || firstResult);
  const review = task.status === TaskStatus.Review;
  const working = task.status === TaskStatus.Running;
  const checking =
    working && task.nodes.findLast((node) => node.kind !== NodeKind.Verify)?.key.startsWith(FRONTEND_VERIFY_PREFIX);
  const canPick = tabId !== undefined && notes.length < FRONTEND_ANNOTATION_LIMIT;
  const verified = task.frontend?.verified === true;
  const status =
    verified && review
      ? C.verified
      : checking
        ? C.checking
        : working && ready
          ? C.editing
          : ready
            ? C.ready
            : C.waiting;

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
          setPanel('progress');
        },
      },
    );
  }

  return (
    <section className={styles.workbench} data-testid="frontend-workbench" aria-label={C.preview}>
      <header className={styles.toolbar}>
        <div className={styles.status}>
          <strong>{C.preview}</strong>
          <span className="hint" aria-live="polite">
            {status}
          </span>
        </div>
        {tabId !== undefined && (
          <Button variant="ghost" size="sm" icon="sparkle" onClick={() => showAssistant(true)}>
            {C.assistant}
          </Button>
        )}
        <Button
          variant={panel === 'notes' ? 'primary' : 'secondary'}
          size="sm"
          icon="edit"
          aria-expanded={panel === 'notes'}
          disabled={!ready}
          onClick={() => toggle('notes')}
        >
          {C.mark}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon="list"
          aria-expanded={panel === 'progress'}
          onClick={() => toggle('progress')}
        >
          {C.progress}
        </Button>
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
                  onSuccess: () => setPanel('progress'),
                },
              );
            }}
          >
            {C.finish}
          </Button>
        )}
      </header>
      {finish.isError && <ErrorState error={finish.error} />}
      <div className={styles.body}>
        <div className={styles.preview}>
          {ready && preview.data !== undefined ? (
            <MyPreview task={task} preview={preview.data} active pro={pro} autoStart={firstResult} />
          ) : preview.isError ? (
            <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />
          ) : (
            <div className={styles.waiting}>
              <strong>{C.waiting}</strong>
              <p className="hint">{C.waitingHint}</p>
              {task.currentStep !== null && <p>{task.currentStep}</p>}
            </div>
          )}
        </div>
        {panel !== null && (
          <aside className={styles.inspector} aria-label={panel === 'notes' ? C.notes : C.progress}>
            {panel === 'notes' ? (
              <>
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
              </>
            ) : (
              <>
                {progress}
                <FrontendRoundHistory task={task} onOpen={onOpenNode} />
              </>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
