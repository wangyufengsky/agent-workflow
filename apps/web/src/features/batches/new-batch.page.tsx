import {
  BATCH_TARGET_PLACEHOLDER,
  BATCH_TARGETS_MAX,
  renderBatchRequirement,
  UiMode,
  WorkflowKind,
  WorkflowPlanning,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { MOD_KEY } from '../../app/platform.ts';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { BATCH_DEFAULT_TEMPLATE, BATCHES_COPY as C } from '../../copy/batches.ts';
import { projectsQuery } from '../projects/projects.queries.ts';
import { useSettings } from '../settings/settings.queries.ts';
import { workflowsQuery } from '../tasks/tasks.queries.ts';
import styles from './batches.module.css';
import { useCreateBatch } from './batches.queries.ts';
import { TargetPicker } from './target-picker.tsx';
import { parseTargets } from './targets.ts';

const route = getRouteApi(ROUTE_IDS.batchNew);

/** Why the batch cannot be created yet, if anything is wrong with what was typed. */
function problemOf(template: string, targets: readonly string[]): string | undefined {
  if (!template.includes(BATCH_TARGET_PLACEHOLDER)) return C.templateMissing;
  if (targets.length > BATCH_TARGETS_MAX) return C.tooMany(BATCH_TARGETS_MAX);
  if (new Set(targets).size !== targets.length) return C.duplicate;
  return undefined;
}

/**
 * 「新建批量任务」(20 §2): project, a fixed workflow, the requirement template and the targets; one task per target.
 * Simple mode lists the built-in fixed workflows, pro mode also custom ones (like the start form).
 */
export function NewBatchPage() {
  const search = route.useSearch();
  const navigate = useNavigate();
  const pro = useSettings()['ui.mode'] === UiMode.Pro;
  const projects = useQuery(projectsQuery).data ?? [];
  const workflows = useQuery(workflowsQuery);
  const fixed = workflows.data?.filter(
    (w) => w.planning === WorkflowPlanning.Fixed && (pro || w.kind === WorkflowKind.Builtin),
  );
  const [projectId, setProjectId] = useState(
    projects.some((p) => p.id === search.projectId) ? search.projectId : projects[0]?.id,
  );
  const [workflowId, setWorkflowId] = useState<string | undefined>(undefined);
  const [edited, setEdited] = useState<string | undefined>(undefined);
  const [text, setText] = useState('');
  const create = useCreateBatch();

  const project = projects.find((p) => p.id === projectId);
  const workflow =
    fixed?.find((w) => w.id === workflowId) ?? fixed?.find((w) => w.key === search.workflow) ?? fixed?.[0];
  // The workflow's default template until the user edits it.
  const template =
    edited ?? (workflow === undefined ? '' : (BATCH_DEFAULT_TEMPLATE[workflow.key] ?? BATCH_TARGET_PLACEHOLDER));
  const targets = parseTargets(text);
  const problem = problemOf(template, targets);
  const [first] = targets;
  const canCreate = project !== undefined && workflow !== undefined && targets.length > 0 && problem === undefined;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canCreate) return;
    create.mutate(
      { projectId: project.id, workflowId: workflow.id, requirementTemplate: template.trim(), targets },
      { onSuccess: (batch) => void navigate({ to: ROUTES.batch, params: { batchId: batch.id } }) },
    );
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{C.newTitle}</h1>
          <p className="lede">{C.newLede}</p>
        </div>
      </div>
      <form className="card pad col" onSubmit={submit} onKeyDown={onKeyDown} aria-label={C.newTitle}>
        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="batch-project">
              {C.project}
            </label>
            <select
              id="batch-project"
              className="select"
              value={projectId ?? ''}
              onChange={(e) => {
                setProjectId(e.target.value);
                setText('');
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
              <label className="label" htmlFor="batch-workflow">
                {C.workflow}
              </label>
              <select
                id="batch-workflow"
                className="select"
                value={workflow?.id ?? ''}
                onChange={(e) => {
                  setWorkflowId(e.target.value);
                  setEdited(undefined);
                }}
              >
                {fixed?.map((w) => (
                  <option key={w.id} value={w.id}>
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
          <label className="label" htmlFor="batch-template">
            {C.template}
          </label>
          <textarea
            id="batch-template"
            className="textarea"
            rows={3}
            value={template}
            onChange={(e) => setEdited(e.target.value)}
          />
          <span className="hint">{C.templateHint}</span>
        </div>
        <div className="field">
          <span className="label">{C.targets}</span>
          {project !== undefined && (
            // A new project starts the tree at its root again.
            <TargetPicker
              key={project.id}
              projectId={project.id}
              refName={project.defaultBranch}
              text={text}
              onChange={setText}
            />
          )}
          <span className="hint" data-testid="batch-selected">
            {C.selected(targets.length)}
          </span>
        </div>
        {first !== undefined && problem === undefined && (
          <div className="field">
            <span className="label">{C.preview}</span>
            <div className={styles.preview} data-testid="batch-preview">
              {renderBatchRequirement(template, first)}
            </div>
          </div>
        )}
        {problem !== undefined && <p className="error-text">{problem}</p>}
        {create.isError && <ErrorState error={create.error} />}
        <div className="row">
          <span className="grow" />
          <Button type="submit" variant="primary" icon="layers" pending={create.isPending} disabled={!canCreate}>
            {C.submit(targets.length)}
            <span className="kbd">
              {MOD_KEY}
              {C.submitShortcut}
            </span>
          </Button>
        </div>
      </form>
    </div>
  );
}
