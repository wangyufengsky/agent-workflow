import { type ProjectDTO, type ScheduleDetailDTO, UiMode, WorkflowKind, WorkflowPlanning } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { SCHEDULES_COPY as C, SCHEDULE_DEFAULT_REQUIREMENT } from '../../copy/schedules.ts';
import { gitBranchesQuery } from '../git/git.queries.ts';
import { useSettings } from '../settings/settings.queries.ts';
import { workflowsQuery } from '../tasks/tasks.queries.ts';
import { DEFAULT_FREQUENCY, draftOf, FrequencyPicker, frequencyOf } from './frequency-picker.tsx';

export type ScheduleFormValue = {
  projectId: string;
  workflowKey: string;
  requirement: string;
  frequency: NonNullable<ReturnType<typeof frequencyOf>>;
  /** Null: the project's default branch. */
  baseBranch: string | null;
};

function BranchField({
  projectId,
  value,
  onChange,
}: {
  projectId: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const branches = useQuery(gitBranchesQuery(projectId));
  const local = branches.data?.filter((b) => !b.remote) ?? [];
  return (
    <div className="field">
      <label className="label" htmlFor="schedule-branch">
        {C.baseBranch}
      </label>
      <select
        id="schedule-branch"
        className="select"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">{C.defaultBranch}</option>
        {local.map((b) => (
          <option key={b.name} value={b.name}>
            {b.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * New and changed schedules (22 §7): project (fixed once created), a fixed workflow, what to do and how often. Simple
 * mode lists the built-in fixed workflows, pro mode also custom ones and the base branch.
 */
export function ScheduleForm({
  projects,
  initial,
  initialProjectId,
  initialWorkflowKey,
  submitLabel,
  pending,
  error,
  onSubmit,
}: {
  projects: ProjectDTO[];
  initial?: ScheduleDetailDTO;
  initialProjectId?: string | undefined;
  initialWorkflowKey?: string | undefined;
  submitLabel: string;
  pending: boolean;
  error: Error | null;
  onSubmit: (value: ScheduleFormValue) => void;
}) {
  const pro = useSettings()['ui.mode'] === UiMode.Pro;
  const workflows = useQuery(workflowsQuery);
  const fixed = workflows.data?.filter(
    (w) =>
      w.planning === WorkflowPlanning.Fixed &&
      (pro || w.kind === WorkflowKind.Builtin || w.key === initial?.workflow.key),
  );
  const [projectId, setProjectId] = useState(
    initial?.project.id ?? (projects.some((p) => p.id === initialProjectId) ? initialProjectId : projects[0]?.id),
  );
  const [workflowKey, setWorkflowKey] = useState(initial?.workflow.key ?? initialWorkflowKey);
  const [edited, setEdited] = useState(initial?.requirement);
  const [draft, setDraft] = useState(initial === undefined ? DEFAULT_FREQUENCY : draftOf(initial.frequency));
  const [baseBranch, setBaseBranch] = useState(initial?.baseBranch ?? null);

  const workflow = fixed?.find((w) => w.key === workflowKey) ?? fixed?.[0];
  // The workflow's default requirement until the user edits it.
  const requirement = edited ?? (workflow === undefined ? '' : (SCHEDULE_DEFAULT_REQUIREMENT[workflow.key] ?? ''));
  const frequency = frequencyOf(draft);
  const canSubmit =
    projectId !== undefined && workflow !== undefined && requirement.trim() !== '' && frequency !== undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({ projectId, workflowKey: workflow.key, requirement: requirement.trim(), frequency, baseBranch });
  };

  return (
    <form className="card pad col" onSubmit={submit} aria-label={submitLabel}>
      <div className="grid-2">
        <div className="field">
          <label className="label" htmlFor="schedule-project">
            {C.project}
          </label>
          <select
            id="schedule-project"
            className="select"
            value={projectId ?? ''}
            disabled={initial !== undefined}
            onChange={(e) => {
              setProjectId(e.target.value);
              setBaseBranch(null);
            }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {/* Its own box: `.field + .field` would push it below the project. */}
        <div>
          <div className="field">
            <label className="label" htmlFor="schedule-workflow">
              {C.workflow}
            </label>
            <select
              id="schedule-workflow"
              className="select"
              value={workflow?.key ?? ''}
              onChange={(e) => {
                setWorkflowKey(e.target.value);
                if (initial === undefined) setEdited(undefined);
              }}
            >
              {fixed?.map((w) => (
                <option key={w.key} value={w.key}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      {workflows.isError && <ErrorState error={workflows.error} onRetry={() => void workflows.refetch()} />}
      {fixed?.length === 0 && <p className="hint">{C.noFixedWorkflow}</p>}
      <div className="field">
        <label className="label" htmlFor="schedule-requirement">
          {C.requirement}
        </label>
        <textarea
          id="schedule-requirement"
          className="textarea"
          rows={3}
          value={requirement}
          onChange={(e) => setEdited(e.target.value)}
        />
      </div>
      <div className="field">
        <span className="label">{C.frequency}</span>
        <FrequencyPicker value={draft} onChange={setDraft} />
      </div>
      {pro && projectId !== undefined && (
        <BranchField key={projectId} projectId={projectId} value={baseBranch} onChange={setBaseBranch} />
      )}
      <p className="hint">
        {C.whileOpen}
        <br />
        {C.howResults}
      </p>
      {error !== null && <ErrorState error={error} />}
      <div className="row">
        <span className="grow" />
        <Button type="submit" variant="primary" icon="clock" pending={pending} disabled={!canSubmit}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
