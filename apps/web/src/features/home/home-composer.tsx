import { type AssistantConversationDTO, type ProjectDTO, WorkflowKind, WorkflowPlanning } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { MOD_KEY } from '../../app/platform.ts';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { ASSISTANT_COPY } from '../../copy/assistant.ts';
import { BATCHES_COPY } from '../../copy/batches.ts';
import { HOME_COPY as C } from '../../copy/home.ts';
import { SCHEDULES_COPY } from '../../copy/schedules.ts';
import { HOME_TASK_COPY } from '../../copy/tasks.ts';
import { useUiStore } from '../../state/ui.store.ts';
import { useAbortAssistant } from '../assistant/assistant.queries.ts';
import { useAsk } from '../assistant/use-ask.ts';
import { workflowsQuery } from '../tasks/tasks.queries.ts';
import styles from './home.module.css';
import { MoreOptionsFields } from './more-options.tsx';
import { useStartTask } from './use-start-task.ts';
import { workflowIcon } from './workflow-icon.ts';

/**
 * The home page's one input (28 §2.2, D111). It asks the assistant, or — once a workflow is picked — starts a task
 * with it in one step, without the assistant; the mode is always written in the box. `conversation` is the one the
 * page shows; asking without one starts a new conversation.
 */
export function HomeComposer({
  conversation,
  projects,
  projectId,
  onProjectChange,
  initialWorkflowKey,
  initialRequirement,
  docked,
}: {
  conversation: AssistantConversationDTO | undefined;
  projects: readonly ProjectDTO[];
  projectId: string;
  onProjectChange: (id: string) => void;
  initialWorkflowKey: string | undefined;
  initialRequirement: string | undefined;
  /** Under a conversation rather than in the hero: a smaller box. */
  docked: boolean;
}) {
  const workflows = useQuery(workflowsQuery);
  const [text, setText] = useState(initialRequirement ?? '');
  const [workflowKey, setWorkflowKey] = useState(initialWorkflowKey);
  const ask = useAsk();
  const abort = useAbortAssistant();
  const input = useRef<HTMLTextAreaElement>(null);
  const focusSeq = useUiStore((s) => s.homeInputFocus);
  const task = useStartTask({
    projectId,
    workflowId: workflows.data?.find((w) => w.key === workflowKey)?.id,
    requirement: text,
  });
  const shown = workflows.data?.filter((w) => task.pro || w.kind === WorkflowKind.Builtin);
  const workflow = shown?.find((w) => w.key === workflowKey);
  const busy = conversation?.busy === true;
  const empty = text.trim() === '';

  // ⌘J and the top bar's assistant button bring the user here on the home page (D112).
  useEffect(() => {
    if (focusSeq > 0) input.current?.focus();
  }, [focusSeq]);

  const send = () => {
    if (workflow !== undefined) task.start();
    else if (!empty && !busy) ask.ask(text.trim(), conversation, () => setText(''));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className={styles.composerArea} data-docked={docked || undefined}>
      <form className={styles.box} data-mode={workflow === undefined ? 'ask' : 'task'} onSubmit={submit}>
        {workflow !== undefined && (
          <div className={styles.modeHead}>
            <span className={styles.modeTag}>
              <Icon name={workflowIcon(workflow.key)} size="sm" />
              {C.startTask(workflow.name)}
              <button
                type="button"
                className={styles.modeClear}
                aria-label={C.askInstead}
                onClick={() => setWorkflowKey(undefined)}
              >
                <Icon name="x" size="sm" />
              </button>
            </span>
            <span className={styles.modeDescription}>{workflow.description}</span>
          </div>
        )}
        <textarea
          ref={input}
          className={styles.input}
          rows={docked ? 1 : 3}
          aria-label={workflow === undefined ? C.inputLabel : HOME_TASK_COPY.requirement}
          placeholder={docked ? C.conversationPlaceholder : C.placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {workflow !== undefined && task.pro && (
          <MoreOptionsFields projectId={projectId} value={task.options} onChange={task.setOptions} />
        )}
        <div className={styles.boxFoot}>
          {workflow === undefined ? (
            <span className={`${styles.hint} grow`}>{C.askHint}</span>
          ) : (
            <>
              {projects.length > 1 && (
                <select
                  className={styles.pillSelect}
                  aria-label={HOME_TASK_COPY.project}
                  value={projectId}
                  onChange={(e) => onProjectChange(e.target.value)}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
              <label className="check">
                <input
                  type="checkbox"
                  checked={task.confirmPlan}
                  onChange={(e) => task.setConfirmPlan(e.target.checked)}
                />
                <span>{HOME_TASK_COPY.confirmPlan}</span>
              </label>
              {/* Fixed workflows can run on several targets at once (20 §2) and on a schedule (22 §7). */}
              {workflow.planning === WorkflowPlanning.Fixed && (
                <>
                  <Link
                    to={ROUTES.batchNew}
                    search={{ projectId, workflow: workflow.key }}
                    className={styles.modeLink}
                    aria-label={BATCHES_COPY.batchOf(workflow.name)}
                  >
                    {C.batch}
                  </Link>
                  <Link
                    to={ROUTES.scheduleNew}
                    search={{ projectId, workflow: workflow.key }}
                    className={styles.modeLink}
                    aria-label={SCHEDULES_COPY.scheduleOf(workflow.name)}
                  >
                    {C.schedule}
                  </Link>
                </>
              )}
              <span className="grow" />
              {task.blocked !== undefined && (
                <span id="start-blocked" className={styles.hint}>
                  {task.blocked}
                </span>
              )}
              {task.pro && (
                <Button
                  size="sm"
                  pending={task.create.isPending}
                  disabled={!task.canStart}
                  onClick={() => task.start(true)}
                >
                  {HOME_TASK_COPY.saveDraft}
                </Button>
              )}
            </>
          )}
          {workflow !== undefined ? (
            <Button
              type="submit"
              size="sm"
              variant="primary"
              icon="sparkle"
              pending={task.create.isPending}
              disabled={!task.canStart}
              aria-describedby={task.blocked === undefined ? undefined : 'start-blocked'}
            >
              {HOME_TASK_COPY.start}
              <span className="kbd">
                {MOD_KEY}
                {HOME_TASK_COPY.startShortcut}
              </span>
            </Button>
          ) : busy && conversation !== undefined ? (
            <button
              type="button"
              className={styles.send}
              data-variant="stop"
              aria-label={ASSISTANT_COPY.stop}
              title={ASSISTANT_COPY.stop}
              disabled={abort.isPending}
              onClick={() => abort.mutate(conversation.id)}
            >
              <Icon name="stop" size="sm" />
            </button>
          ) : (
            <>
              <span className="kbd">{ASSISTANT_COPY.sendHint}</span>
              <button
                type="submit"
                className={styles.send}
                aria-label={C.send}
                title={C.send}
                disabled={empty || ask.isPending}
              >
                {ask.isPending ? <span className="spin" aria-hidden="true" /> : <Icon name="arrowUp" size="sm" />}
              </button>
            </>
          )}
        </div>
        {task.create.isError && <ErrorState error={task.create.error} />}
        {ask.error !== null && <ErrorState error={ask.error} />}
      </form>
      {workflows.isError && <ErrorState error={workflows.error} onRetry={() => void workflows.refetch()} />}
      <fieldset className={styles.strip}>
        <legend className={styles.cap}>{C.startNow}</legend>
        {shown?.map((w) => (
          <button
            key={w.id}
            type="button"
            className={styles.chip}
            aria-pressed={w.key === workflowKey}
            title={w.description}
            onClick={() => {
              setWorkflowKey(w.key);
              input.current?.focus();
            }}
          >
            <Icon name={workflowIcon(w.key)} size="sm" />
            {w.name}
          </button>
        ))}
      </fieldset>
    </div>
  );
}
