import { type AssistantConversationDTO, type ProjectDTO, WorkflowKind, WorkflowPlanning } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { MOD_KEY } from '../../app/platform.ts';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { ASSISTANT_COPY } from '../../copy/assistant.ts';
import { ATTACHMENTS_COPY } from '../../copy/attachments.ts';
import { BATCHES_COPY } from '../../copy/batches.ts';
import { HOME_COPY as C } from '../../copy/home.ts';
import { SCHEDULES_COPY } from '../../copy/schedules.ts';
import { HOME_TASK_COPY } from '../../copy/tasks.ts';
import { useUiStore } from '../../state/ui.store.ts';
import { AddMenu, type AddMenuItem } from '../assistant/add-menu.tsx';
import { useAbortAssistant } from '../assistant/assistant.queries.ts';
import { useContextAttachments } from '../assistant/context-attachments.tsx';
import { UsageButton } from '../assistant/usage-line.tsx';
import { useAsk } from '../assistant/use-ask.ts';
import { AttachmentList, dropFilesInto, pasteFilesInto, useAttachmentPickers } from '../attachments/attachment-bar.tsx';
import { useAttachmentDraft } from '../attachments/use-attachment-draft.ts';
import type { DraftRequirement } from '../requirements/checklist-editor.tsx';
import { ChecklistField } from '../requirements/checklist-field.tsx';
import { workflowsQuery } from '../tasks/tasks.queries.ts';
import styles from './home.module.css';
import { MoreOptionsFields } from './more-options.tsx';
import { useStartTask } from './use-start-task.ts';
import { workflowIcon } from './workflow-icon.ts';
import { WorkflowPicker } from './workflow-picker.tsx';

/**
 * The home page's one input (28 §2.2, D111). It asks the assistant, or — once a workflow is picked — starts a task
 * with it in one step, without the assistant; the mode is always written in the box. `conversation` is the one the
 * page shows; asking without one starts a new conversation. The box is two rows — the text and a foot with「+」,
 *「直接开始」, usage and send — and the workflows unfold inside it on demand (36 §2, D144–D145).
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
  const files = useAttachmentDraft();
  const context = useContextAttachments(files);
  const [flowsOpen, setFlowsOpen] = useState(false);
  const flowsId = useId();
  const flowsOpener = useRef<HTMLButtonElement>(null);
  const [checklist, setChecklist] = useState<DraftRequirement[]>([]);
  const task = useStartTask({
    projectId,
    workflowId: workflows.data?.find((w) => w.key === workflowKey)?.id,
    requirement: text,
    attachmentIds: files.ids,
    attachmentsBlocked: files.blocked,
    requirements: checklist,
    onStarted: () => {
      files.clear();
      setChecklist([]);
    },
  });
  const project = projects.find((p) => p.id === projectId);
  const pickers = useAttachmentPickers(
    files,
    project === undefined ? undefined : { projectId: project.id, refName: 'HEAD' },
  );
  // A base branch belongs to the project it was picked in.
  const changeProject = (id: string) => {
    task.setOptions({ ...task.options, baseBranch: null });
    onProjectChange(id);
  };
  const shown = workflows.data?.filter((w) => task.pro || w.kind === WorkflowKind.Builtin);
  const workflow = shown?.find((w) => w.key === workflowKey);
  const busy = conversation?.busy === true;
  const empty = text.trim() === '';
  const addItems: AddMenuItem[] = [
    { label: ATTACHMENTS_COPY.menuUpload, icon: 'paperclip', onSelect: pickers.pickFile },
  ];
  if (pickers.pickProjectFile !== undefined)
    addItems.push({ label: ATTACHMENTS_COPY.menuProjectFile, icon: 'folder', onSelect: pickers.pickProjectFile });
  // The main page's assistant context has no place in a task's requirement (15 §6).
  if (workflow === undefined) addItems.push(...context.items);
  // The opener is whichever button was pressed: 「直接开始」 in ask mode, the mode tag's name in task mode.
  const toggleFlows = (opener: HTMLButtonElement) => {
    flowsOpener.current = opener;
    setFlowsOpen((open) => !open);
  };

  // ⌘J and the top bar's assistant button bring the user here on the home page (D112).
  useEffect(() => {
    if (focusSeq > 0) input.current?.focus();
  }, [focusSeq]);

  const send = () => {
    if (workflow !== undefined) task.start();
    else if (!empty && !busy && !files.blocked) {
      ask.ask(
        text.trim(),
        conversation,
        () => {
          setText('');
          files.clear();
        },
        files.ids,
      );
    }
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
      <form
        className={styles.box}
        data-mode={workflow === undefined ? 'ask' : 'task'}
        onSubmit={submit}
        {...dropFilesInto(files)}
      >
        {workflow !== undefined && (
          <div className={styles.modeHead}>
            <div className={styles.modeRow}>
              <span className={styles.modeTag}>
                <button
                  type="button"
                  className={styles.modeName}
                  aria-label={`${C.changeWorkflow} · ${C.startTask(workflow.name)}`}
                  aria-expanded={flowsOpen}
                  aria-controls={flowsId}
                  onClick={(e) => toggleFlows(e.currentTarget)}
                >
                  <Icon name={workflowIcon(workflow.key)} size="sm" />
                  {C.startTask(workflow.name)}
                  <span className={styles.flowsChevron} aria-hidden="true">
                    <Icon name="chevDown" size="sm" />
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.modeClear}
                  aria-label={C.askInstead}
                  onClick={() => setWorkflowKey(undefined)}
                >
                  <Icon name="x" size="sm" />
                </button>
              </span>
              {/* The task's project, always shown: the base branch and the batch / schedule links depend on it. */}
              <label className={styles.projectPick}>
                <span aria-hidden="true">{HOME_TASK_COPY.project}</span>
                <select
                  className={styles.pillSelect}
                  aria-label={HOME_TASK_COPY.project}
                  value={projectId}
                  onChange={(e) => changeProject(e.target.value)}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <span className={styles.modeDescription}>{workflow.description}</span>
          </div>
        )}
        <textarea
          ref={input}
          className={styles.input}
          rows={docked ? 1 : 3}
          aria-label={workflow === undefined ? C.inputLabel : HOME_TASK_COPY.requirement}
          placeholder={
            workflow !== undefined
              ? HOME_TASK_COPY.requirementPlaceholder
              : docked
                ? C.conversationPlaceholder
                : C.placeholder
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={pasteFilesInto(files)}
        />
        <AttachmentList draft={files} />
        {workflow !== undefined && <ChecklistField drafts={checklist} onChange={setChecklist} />}
        {workflow !== undefined && task.pro && project !== undefined && (
          <MoreOptionsFields project={project} value={task.options} onChange={task.setOptions} />
        )}
        {shown !== undefined && (
          <WorkflowPicker
            id={flowsId}
            open={flowsOpen}
            workflows={shown}
            picked={workflowKey}
            opener={flowsOpener}
            onPick={(key) => {
              setWorkflowKey(key);
              setFlowsOpen(false);
              input.current?.focus();
            }}
            onClose={() => setFlowsOpen(false)}
          />
        )}
        <div className={styles.boxFoot}>
          <AddMenu items={addItems} onOpen={context.capture} />
          {workflow === undefined ? (
            <>
              <button
                type="button"
                className={styles.flowsToggle}
                aria-expanded={flowsOpen}
                aria-controls={flowsId}
                onClick={(e) => toggleFlows(e.currentTarget)}
              >
                <Icon name="sparkle" size="sm" />
                {C.startNow}
                <span className={styles.flowsChevron} aria-hidden="true">
                  <Icon name="chevDown" size="sm" />
                </span>
              </button>
              <span className="grow" />
              {conversation !== undefined && <UsageButton usage={conversation.usage} />}
            </>
          ) : (
            <>
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
                disabled={empty || ask.isPending || files.blocked}
              >
                {ask.isPending ? <span className="spin" aria-hidden="true" /> : <Icon name="arrowUp" size="sm" />}
              </button>
            </>
          )}
        </div>
        {task.create.isError && <ErrorState error={task.create.error} />}
        {ask.error !== null && <ErrorState error={ask.error} />}
        {pickers.elements}
        {context.elements}
      </form>
      {workflows.isError && <ErrorState error={workflows.error} onRetry={() => void workflows.refetch()} />}
    </div>
  );
}
