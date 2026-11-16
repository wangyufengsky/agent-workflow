import {
  type AssistantConversationDTO,
  type AttachmentDTO,
  InitiativeTemplateKind,
  type ProjectDTO,
  WorkflowKind,
  WorkflowPlanning,
} from '@aw/shared';
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
import { COMMON_COPY } from '../../copy/common.ts';
import { HOME_COPY as C } from '../../copy/home.ts';
import { INITIATIVES_COPY } from '../../copy/initiatives.ts';
import { KNOWLEDGE_COPY } from '../../copy/knowledge.ts';
import { SCHEDULES_COPY } from '../../copy/schedules.ts';
import { HOME_TASK_COPY } from '../../copy/tasks.ts';
import { useUiStore } from '../../state/ui.store.ts';
import { AddMenu, type AddMenuItem } from '../assistant/add-menu.tsx';
import { useAbortAssistant } from '../assistant/assistant.queries.ts';
import { useContextAttachments } from '../assistant/context-attachments.tsx';
import { ConversationProjectSelect } from '../assistant/conversation-project-select.tsx';
import { UsageButton } from '../assistant/usage-line.tsx';
import { useAsk } from '../assistant/use-ask.ts';
import { AttachmentList, dropFilesInto, pasteFilesInto, useAttachmentPickers } from '../attachments/attachment-bar.tsx';
import { SentAttachments } from '../attachments/sent-attachments.tsx';
import { useAttachmentDraft } from '../attachments/use-attachment-draft.ts';
import { AllowedWorkflowsField } from '../initiatives/allowed-workflows-field.tsx';
import { initiativeTemplatesQuery } from '../initiatives/initiatives.queries.ts';
import { templateChain, useStartInitiative } from '../initiatives/use-start-initiative.ts';
import { ProjectPicker } from '../projects/project-picker.tsx';
import type { DraftRequirement } from '../requirements/checklist-editor.tsx';
import { ChecklistField } from '../requirements/checklist-field.tsx';
import { AssistantSkillPicker } from '../skills/assistant-skill-picker.tsx';
import { WorkflowSkillSummary } from '../skills/workflow-skill-summary.tsx';
import { workflowsQuery } from '../tasks/tasks.queries.ts';
import styles from './home.module.css';
import { MoreOptionsFields } from './more-options.tsx';
import { useStartTask } from './use-start-task.ts';
import { workflowIcon } from './workflow-icon.ts';
import { WorkflowPicker } from './workflow-picker.tsx';

/**
 * The home page's one input (28 §2.2, D111). It asks the assistant, or — once a workflow is picked — starts a task
 * with it in one step, without the assistant — or, with a composition template, an initiative (34 §15.4); the mode
 * is always written in the box. `conversation` is the one the
 * page shows; asking without one starts a new conversation. The box is two rows — the text and a foot with「+」,
 *「直接开始」, usage and send — and the workflows unfold inside it on demand (36 §2, D144–D145).
 */
export function HomeComposer({
  conversation,
  projects,
  projectId,
  onProjectChange,
  assistantProjectId,
  onAssistantProjectChange,
  initialWorkflowKey,
  initialRequirement,
  knowledgeDraft,
  docked,
}: {
  conversation: AssistantConversationDTO | undefined;
  projects: readonly ProjectDTO[];
  projectId: string;
  onProjectChange: (id: string) => void;
  assistantProjectId: string | null;
  onAssistantProjectChange: (id: string | null) => void;
  initialWorkflowKey: string | undefined;
  initialRequirement: string | undefined;
  knowledgeDraft?:
    | { attachment: AttachmentDTO | undefined; loading: boolean; error: unknown; retry(): void; dismiss(): void }
    | undefined;
  /** Under a conversation rather than in the hero: a smaller box. */
  docked: boolean;
}) {
  const workflows = useQuery(workflowsQuery);
  const templates = useQuery(initiativeTemplatesQuery);
  const continuation = conversation?.continuation;
  const [text, setText] = useState(
    initialRequirement ?? (continuation?.consumedAt === null ? continuation.draftText : null) ?? '',
  );
  const [workflowKey, setWorkflowKey] = useState(initialWorkflowKey);
  const [templateKey, setTemplateKey] = useState<string>();
  // 「让 AI 拆解」: an initiative the AI breaks down, instead of one made from a template (34 §5.1).
  const [breakdown, setBreakdown] = useState(false);
  const [allowedWorkflows, setAllowedWorkflows] = useState<string[] | undefined>(undefined);
  const ask = useAsk();
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const abort = useAbortAssistant();
  const input = useRef<HTMLTextAreaElement>(null);
  const focusSeq = useUiStore((s) => s.homeInputFocus);
  const material = knowledgeDraft?.attachment;
  const files = useAttachmentDraft(knowledgeDraft === undefined ? 0 : 1);
  const context = useContextAttachments(files);
  const [flowsOpen, setFlowsOpen] = useState(false);
  const flowsId = useId();
  const flowsOpener = useRef<HTMLButtonElement>(null);
  const [checklist, setChecklist] = useState<DraftRequirement[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreId = useId();
  const task = useStartTask({
    projectId,
    workflowId: workflows.data?.find((w) => w.key === workflowKey)?.id,
    requirement: text,
    attachmentIds: material === undefined ? files.ids : [material.id, ...files.ids],
    attachmentsBlocked: files.blocked || (knowledgeDraft !== undefined && material === undefined),
    requirements: checklist,
    onStarted: () => {
      files.clear();
      setChecklist([]);
    },
  });
  const initiative = useStartInitiative({
    projectId,
    templateKey,
    breakdown,
    // Only pro mode chooses; simple mode keeps the default (34 §5.1).
    allowedWorkflows: task.pro ? allowedWorkflows : undefined,
    requirement: text,
    attachmentIds: files.ids,
    attachmentsBlocked: files.blocked,
    onStarted: () => files.clear(),
  });
  const project = projects.find((p) => p.id === projectId);
  const selectedAssistantId = conversation === undefined ? assistantProjectId : conversation.projectId;
  const attachmentProject =
    workflowKey !== undefined || templateKey !== undefined || breakdown
      ? project
      : projects.find((p) => p.id === selectedAssistantId);
  const pickers = useAttachmentPickers(
    files,
    attachmentProject === undefined ? undefined : { projectId: attachmentProject.id, refName: 'HEAD' },
  );
  // A base branch belongs to the project it was picked in.
  const changeProject = (id: string) => {
    task.setOptions({ ...task.options, baseBranch: null });
    onProjectChange(id);
  };
  const shown = workflows.data?.filter((w) => task.pro || w.kind === WorkflowKind.Builtin);
  const workflow = shown?.find((w) => w.key === workflowKey);
  const template = templates.data?.find((t) => t.key === templateKey);
  // An initiative is started from a template or by the AI's breakdown.
  const initiativeMode = template !== undefined || breakdown;
  // What the box starts besides asking: a task with a workflow, or an initiative.
  const mode =
    workflow !== undefined
      ? { start: C.startTask(workflow.name), icon: workflowIcon(workflow.key), description: workflow.description }
      : breakdown
        ? {
            start: INITIATIVES_COPY.startBreakdown,
            icon: 'sparkle' as const,
            description: INITIATIVES_COPY.aiBreakdownDescription,
          }
        : template !== undefined
          ? {
              start: INITIATIVES_COPY.startTemplate(template.name),
              icon: 'split' as const,
              description: `${templateChain(template, workflows.data ?? [])} · ${template.description}`,
            }
          : undefined;
  const busy = conversation?.busy === true;
  const empty = text.trim() === '';
  const addItems: AddMenuItem[] = [
    { label: ATTACHMENTS_COPY.menuUpload, icon: 'paperclip', onSelect: pickers.pickFile },
  ];
  if (pickers.pickProjectFile !== undefined)
    addItems.push({ label: ATTACHMENTS_COPY.menuProjectFile, icon: 'folder', onSelect: pickers.pickProjectFile });
  // The main page's assistant context has no place in a task's requirement (15 §6).
  if (mode === undefined) addItems.push(...context.items);
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
    else if (initiativeMode) initiative.start();
    else if (knowledgeDraft === undefined && !empty && !busy && !ask.isPending && !files.blocked) {
      ask.ask(
        text.trim(),
        conversation,
        () => {
          setText('');
          files.clear();
          setSkillIds([]);
        },
        files.ids,
        assistantProjectId,
        skillIds,
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
        data-mode={mode === undefined ? 'ask' : 'task'}
        onSubmit={submit}
        {...dropFilesInto(files)}
      >
        {mode !== undefined && (
          <div className={styles.modeHead}>
            <div className={styles.modeRow}>
              <span className={styles.modeTag}>
                <button
                  type="button"
                  className={styles.modeName}
                  aria-label={`${C.changeWorkflow} · ${mode.start}`}
                  aria-expanded={flowsOpen}
                  aria-controls={flowsId}
                  onClick={(e) => toggleFlows(e.currentTarget)}
                >
                  <Icon name={mode.icon} size="sm" />
                  {mode.start}
                  <span className={styles.flowsChevron} aria-hidden="true">
                    <Icon name="chevDown" size="sm" />
                  </span>
                </button>
                {knowledgeDraft === undefined && (
                  <button
                    type="button"
                    className={styles.modeClear}
                    aria-label={C.askInstead}
                    onClick={() => {
                      setWorkflowKey(undefined);
                      setTemplateKey(undefined);
                      setBreakdown(false);
                    }}
                  >
                    <Icon name="x" size="sm" />
                  </button>
                )}
              </span>
              {/* The task's project, always shown: the base branch and the batch / schedule links depend on it. */}
              <ProjectPicker
                projects={projects}
                value={projectId}
                disabled={knowledgeDraft !== undefined}
                onChange={changeProject}
              />
            </div>
            <span className={styles.modeDescription}>{mode.description}</span>
            {project !== undefined && workflow !== undefined && (
              <WorkflowSkillSummary projectId={project.id} workflowKey={workflow.key} />
            )}
          </div>
        )}
        {mode === undefined && (
          <ConversationProjectSelect
            value={conversation === undefined ? assistantProjectId : conversation.projectId}
            projects={projects}
            onChange={onAssistantProjectChange}
          />
        )}
        <textarea
          ref={input}
          className={styles.input}
          rows={docked ? 1 : 3}
          aria-label={mode === undefined ? C.inputLabel : HOME_TASK_COPY.requirement}
          placeholder={
            mode !== undefined
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
        {knowledgeDraft !== undefined && (
          <div className="col">
            <div className="row wrap">
              <span className="label grow">{KNOWLEDGE_COPY.taskMaterial}</span>
              <Button size="sm" variant="ghost" onClick={knowledgeDraft.dismiss}>
                {KNOWLEDGE_COPY.removeMaterial}
              </Button>
            </div>
            {material !== undefined && <SentAttachments attachments={[material]} />}
            {material !== undefined && project === undefined && (
              <p className="hint">{KNOWLEDGE_COPY.materialProjectGone}</p>
            )}
            {knowledgeDraft.loading && <p className="hint">{COMMON_COPY.loading}</p>}
            {!knowledgeDraft.loading && material === undefined && (
              <p className="hint">{KNOWLEDGE_COPY.invalidMaterial}</p>
            )}
            {knowledgeDraft.error != null && <ErrorState error={knowledgeDraft.error} onRetry={knowledgeDraft.retry} />}
          </div>
        )}
        <AttachmentList draft={files} />
        {workflow !== undefined && (
          <div className={styles.taskTools}>
            <ChecklistField drafts={checklist} onChange={setChecklist} />
            {task.pro && project !== undefined && (
              <button
                type="button"
                className={styles.optionsToggle}
                aria-expanded={moreOpen}
                aria-controls={moreOpen ? moreId : undefined}
                onClick={() => setMoreOpen((open) => !open)}
              >
                <Icon name="sliders" size="sm" />
                {HOME_TASK_COPY.moreOptions}
                <span className={styles.flowsChevron}>
                  <Icon name="chevDown" size="sm" />
                </span>
              </button>
            )}
          </div>
        )}
        {breakdown && task.pro && (
          <AllowedWorkflowsField
            workflows={workflows.data ?? []}
            value={allowedWorkflows}
            onChange={setAllowedWorkflows}
          />
        )}
        {workflow !== undefined && task.pro && project !== undefined && moreOpen && (
          <MoreOptionsFields
            id={moreId}
            project={project}
            value={task.options}
            onChange={task.setOptions}
            confirmPlan={task.confirmPlan}
            onConfirmPlanChange={task.setConfirmPlan}
          />
        )}
        {shown !== undefined && (
          <WorkflowPicker
            id={flowsId}
            open={flowsOpen}
            workflows={shown}
            allowInitiatives={knowledgeDraft === undefined}
            templates={
              knowledgeDraft === undefined
                ? (templates.data?.filter((t) => task.pro || t.kind === InitiativeTemplateKind.Builtin) ?? [])
                : []
            }
            picked={workflowKey}
            pickedTemplate={templateKey}
            pickedBreakdown={breakdown}
            opener={flowsOpener}
            onPick={(key) => {
              setWorkflowKey(key);
              setTemplateKey(undefined);
              setBreakdown(false);
              setFlowsOpen(false);
              input.current?.focus();
            }}
            onPickTemplate={(key) => {
              setTemplateKey(key);
              setWorkflowKey(undefined);
              setBreakdown(false);
              setFlowsOpen(false);
              input.current?.focus();
            }}
            onPickBreakdown={() => {
              setBreakdown(true);
              setTemplateKey(undefined);
              setWorkflowKey(undefined);
              setFlowsOpen(false);
              input.current?.focus();
            }}
            onClose={() => setFlowsOpen(false)}
          />
        )}
        <div className={styles.boxFoot}>
          <AddMenu items={addItems} onOpen={context.capture} />
          {mode === undefined && <AssistantSkillPicker selected={skillIds} onChange={setSkillIds} />}
          {initiativeMode ? (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  checked={initiative.confirmItemPlans}
                  onChange={(e) => initiative.setConfirmItemPlans(e.target.checked)}
                />
                <span>{INITIATIVES_COPY.confirmItemPlans}</span>
              </label>
              {task.pro && template !== undefined && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={initiative.review}
                    onChange={(e) => initiative.setReview(e.target.checked)}
                  />
                  <span>{INITIATIVES_COPY.review}</span>
                </label>
              )}
              <span className="grow" />
              {initiative.blocked !== undefined && (
                <span id="start-blocked" className={styles.hint}>
                  {initiative.blocked}
                </span>
              )}
            </>
          ) : workflow === undefined ? (
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
              {!task.pro && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={task.confirmPlan}
                    onChange={(e) => task.setConfirmPlan(e.target.checked)}
                  />
                  <span>{HOME_TASK_COPY.confirmPlan}</span>
                </label>
              )}
              {/* Fixed workflows can run on several targets at once (20 §2) and on a schedule (22 §7). */}
              {workflow.planning === WorkflowPlanning.Fixed && knowledgeDraft === undefined && (
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
          {initiativeMode ? (
            <Button
              type="submit"
              size="sm"
              variant="primary"
              icon="sparkle"
              pending={initiative.create.isPending}
              disabled={!initiative.canStart}
              aria-describedby={initiative.blocked === undefined ? undefined : 'start-blocked'}
            >
              {HOME_TASK_COPY.start}
              <span className="kbd">
                {MOD_KEY}
                {HOME_TASK_COPY.startShortcut}
              </span>
            </Button>
          ) : workflow !== undefined ? (
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
                disabled={empty || ask.isPending || files.blocked || knowledgeDraft !== undefined}
              >
                {ask.isPending ? <span className="spin" aria-hidden="true" /> : <Icon name="arrowUp" size="sm" />}
              </button>
            </>
          )}
        </div>
        {task.create.isError && <ErrorState error={task.create.error} />}
        {initiative.create.isError && <ErrorState error={initiative.create.error} />}
        {ask.error !== null && <ErrorState error={ask.error} />}
        {pickers.elements}
        {context.elements}
      </form>
      {workflows.isError && <ErrorState error={workflows.error} onRetry={() => void workflows.refetch()} />}
    </div>
  );
}
