import { type ProjectDTO, TASK_TITLE_MAX_CHARS, UiMode, WorkflowKind, WorkflowPlanning } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { MOD_KEY } from '../../app/platform.ts';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { BATCHES_COPY } from '../../copy/batches.ts';
import { HOME_TASK_COPY as C } from '../../copy/tasks.ts';
import { gitBranchesQuery } from '../git/git.queries.ts';
import { useSettings } from '../settings/settings.queries.ts';
import { useCreateTask, workflowsQuery } from '../tasks/tasks.queries.ts';
import styles from './start-task.module.css';
import { workflowIcon } from './workflow-icon.ts';

/** Pro mode's「更多选项」(M5-09): title, base branch, every checkpoint; null fields use the defaults. */
type MoreOptions = {
  title: string;
  baseBranch: string | null;
  acceptEachNode: boolean | null;
  askOnUncertainty: boolean | null;
};
const NO_OPTIONS: MoreOptions = { title: '', baseBranch: null, acceptEachNode: null, askOnUncertainty: null };

function MoreOptionsFields({
  projectId,
  value,
  onChange,
}: {
  projectId: string;
  value: MoreOptions;
  onChange: (value: MoreOptions) => void;
}) {
  const branches = useQuery({ ...gitBranchesQuery(projectId), enabled: projectId !== '' });
  const askDefault = useSettings()['ai.askOnUncertainty'];
  const local = branches.data?.filter((b) => !b.remote) ?? [];
  return (
    <details className={styles.more}>
      <summary className="hint">{C.moreOptions}</summary>
      <div className="grid-2">
        <div>
          <div className="field">
            <label className="label" htmlFor="start-title">
              {C.title}
            </label>
            <input
              id="start-title"
              className="input"
              maxLength={TASK_TITLE_MAX_CHARS}
              placeholder={C.titlePlaceholder}
              value={value.title}
              onChange={(e) => onChange({ ...value, title: e.target.value })}
            />
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="start-branch">
            {C.baseBranch}
          </label>
          <select
            id="start-branch"
            className="select"
            value={value.baseBranch ?? ''}
            onChange={(e) => onChange({ ...value, baseBranch: e.target.value === '' ? null : e.target.value })}
          >
            <option value="">{C.defaultBranch}</option>
            {local.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={value.acceptEachNode ?? false}
          onChange={(e) => onChange({ ...value, acceptEachNode: e.target.checked })}
        />
        <span>{C.acceptEachNode}</span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={value.askOnUncertainty ?? askDefault}
          onChange={(e) => onChange({ ...value, askOnUncertainty: e.target.checked })}
        />
        <span>{C.askOnUncertainty}</span>
      </label>
    </details>
  );
}

/**
 * One step to start a task (14 §3.2): project, workflow card, requirement, optional plan confirmation. Pro mode also
 * lists custom workflows and offers more options and saving a draft (M5-09).
 */
export function StartTaskForm({
  projects,
  projectId,
  onProjectChange,
  initialWorkflowKey,
  initialRequirement,
}: {
  projects: readonly ProjectDTO[];
  projectId: string;
  onProjectChange: (id: string) => void;
  initialWorkflowKey?: string | undefined;
  initialRequirement?: string | undefined;
}) {
  const pro = useSettings()['ui.mode'] === UiMode.Pro;
  const workflows = useQuery(workflowsQuery);
  const shown = workflows.data?.filter((w) => pro || w.kind === WorkflowKind.Builtin);
  const [workflowId, setWorkflowId] = useState<string | undefined>(undefined);
  const [requirement, setRequirement] = useState(initialRequirement ?? '');
  const [confirmPlan, setConfirmPlan] = useState(false);
  const [options, setOptions] = useState<MoreOptions>(NO_OPTIONS);
  const create = useCreateTask();
  const navigate = useNavigate();
  const selected = workflowId ?? (shown?.find((w) => w.key === initialWorkflowKey) ?? shown?.[0])?.id;
  const canStart = selected !== undefined && projectId !== '' && requirement.trim() !== '';
  // Why「开始」is unavailable, said next to it (only the requirement can be missing once projects and workflows load).
  const blocked = canStart ? undefined : requirement.trim() === '' ? C.needsRequirement : C.needsWorkflow;

  const start = (asDraft = false) => {
    if (!canStart) return;
    const more = pro ? options : NO_OPTIONS;
    const checkpoints = {
      ...(confirmPlan ? { confirm_plan: true } : {}),
      ...(more.acceptEachNode === null ? {} : { accept_each_node: more.acceptEachNode }),
      ...(more.askOnUncertainty === null ? {} : { ask_on_uncertainty: more.askOnUncertainty }),
    };
    create.mutate(
      {
        projectId,
        workflowId: selected,
        requirement: requirement.trim(),
        ...(Object.keys(checkpoints).length === 0 ? {} : { checkpoints }),
        ...(more.title.trim() === '' ? {} : { title: more.title.trim() }),
        ...(more.baseBranch === null ? {} : { baseBranch: more.baseBranch }),
        ...(asDraft ? { start: false } : {}),
      },
      { onSuccess: (task) => void navigate({ to: ROUTES.task, params: { taskId: task.id } }) },
    );
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    start();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      start();
    }
  };

  return (
    <form className="card pad col" onSubmit={submit} aria-label={C.start}>
      {projects.length > 1 && (
        <div className="field">
          <label className="label" htmlFor="start-project">
            {C.project}
          </label>
          <select
            id="start-project"
            className="select"
            value={projectId}
            onChange={(e) => onProjectChange(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <span className="label" id="start-workflow">
          {C.workflow}
        </span>
        {workflows.isError && <ErrorState error={workflows.error} onRetry={() => void workflows.refetch()} />}
        <fieldset className={styles.workflows} aria-labelledby="start-workflow">
          {shown?.map((w) => (
            <div key={w.id} className={styles.card}>
              <button
                type="button"
                className={styles.workflow}
                aria-pressed={w.id === selected}
                onClick={() => setWorkflowId(w.id)}
              >
                <Icon name={workflowIcon(w.key)} />
                <span className={styles.name}>{w.name}</span>
                <span className={styles.description}>{w.description}</span>
              </button>
              {/* Fixed workflows can run on several targets at once (20 §2). */}
              {w.planning === WorkflowPlanning.Fixed && (
                <Link
                  to={ROUTES.batchNew}
                  search={{ projectId, workflow: w.key }}
                  className={`btn ghost sm ${styles.batch}`}
                  aria-label={BATCHES_COPY.batchOf(w.name)}
                >
                  {BATCHES_COPY.batch}
                </Link>
              )}
            </div>
          ))}
        </fieldset>
      </div>
      <div className="field">
        <label className="label" htmlFor="start-requirement">
          {C.requirement}
        </label>
        <textarea
          id="start-requirement"
          className="textarea"
          rows={5}
          placeholder={C.requirementPlaceholder}
          value={requirement}
          onChange={(e) => setRequirement(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      {pro && <MoreOptionsFields projectId={projectId} value={options} onChange={setOptions} />}
      {create.isError && <ErrorState error={create.error} />}
      <div className={styles.footer}>
        <label className="check grow">
          <input type="checkbox" checked={confirmPlan} onChange={(e) => setConfirmPlan(e.target.checked)} />
          <span>{C.confirmPlan}</span>
        </label>
        {pro && (
          <Button pending={create.isPending} disabled={!canStart} onClick={() => start(true)}>
            {C.saveDraft}
          </Button>
        )}
        {blocked !== undefined && (
          <span id="start-blocked" className="hint">
            {blocked}
          </span>
        )}
        <Button
          type="submit"
          variant="primary"
          icon="sparkle"
          pending={create.isPending}
          disabled={!canStart}
          aria-describedby={blocked === undefined ? undefined : 'start-blocked'}
        >
          {C.start}
          <span className="kbd">
            {MOD_KEY}
            {C.startShortcut}
          </span>
        </Button>
      </div>
    </form>
  );
}
