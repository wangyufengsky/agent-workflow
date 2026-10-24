import {
  DEFINITION_KEY_PATTERN,
  RoleBaseAgent,
  type RoleDTO,
  type WorkflowDefinition,
  WorkflowDeliverable,
  WorkflowKind,
  WorkflowPlanning,
  type WorkflowSummaryDTO,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { toast } from '../../components/toast.tsx';
import { BATCHES_COPY } from '../../copy/batches.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { INITIATIVE_TEMPLATES_COPY } from '../../copy/initiatives.ts';
import { SCHEDULES_COPY } from '../../copy/schedules.ts';
import {
  WORKFLOWS_COPY as C,
  WORKFLOW_DELIVERABLE_LABEL,
  WORKFLOW_KIND_LABEL,
  WORKFLOW_PLANNING_LABEL,
} from '../../copy/workflows.ts';
import { workflowIcon } from '../home/workflow-icon.ts';
import { rolesQuery, useCreateWorkflow, useDeleteWorkflow, workflowsQuery } from '../tasks/tasks.queries.ts';

/**
 * A blank definition of each planning kind (13 §5), from the roles that exist: executors do the steps, the first
 * planner plans. The editor fills in the rest.
 */
function blankDefinition(planning: WorkflowPlanning, roles: readonly RoleDTO[]): WorkflowDefinition {
  const executors = roles.filter((r) => r.baseAgent === RoleBaseAgent.Executor).map((r) => r.key);
  const planner = roles.find((r) => r.baseAgent === RoleBaseAgent.Planner)?.key;
  const common = {
    allowedRoles: executors,
    checkpoints: { confirm_plan: false, accept_each_node: false },
    defaultAcceptance: { checks: [], manual: false },
  };
  if (planning === WorkflowPlanning.Ai)
    return { ...common, ...(planner === undefined ? {} : { plannerRole: planner }) };
  const [first] = executors;
  const step = { key: 'step_1', title: C.blankStepTitle, instructions: C.blankStepInstructions, dependsOn: [] };
  return { ...common, template: { nodes: first === undefined ? [] : [{ ...step, roleKey: first }] } };
}

type Target = { mode: 'create' } | { mode: 'copy'; from: WorkflowSummaryDTO };

/** New workflow or copy: a key and name, then the editor (13 §5). */
function NewWorkflowDialog({ target, onClose }: { target: Target; onClose: () => void }) {
  const create = useCreateWorkflow();
  const roles = useQuery(rolesQuery);
  const navigate = useNavigate();
  const [key, setKey] = useState(target.mode === 'copy' ? `${target.from.key}_copy` : '');
  const [name, setName] = useState(target.mode === 'copy' ? C.copyName(target.from.name) : '');
  const [planning, setPlanning] = useState<WorkflowPlanning>(WorkflowPlanning.Fixed);
  const keyValid = DEFINITION_KEY_PATTERN.test(key);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const input =
      target.mode === 'copy'
        ? { key, name: name.trim(), copyFrom: target.from.id }
        : {
            key,
            name: name.trim(),
            planning,
            deliverable: WorkflowDeliverable.CodeChanges,
            definition: blankDefinition(planning, roles.data ?? []),
          };
    create.mutate(input, {
      onSuccess: (workflow) => {
        toast(C.created);
        onClose();
        void navigate({ to: ROUTES.workflow, params: { key: workflow.key } });
      },
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={target.mode === 'copy' ? C.copyTitle(target.from.name) : C.createTitle}
    >
      <form className="col" onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="workflow-key">
            {C.key}
          </label>
          <input
            id="workflow-key"
            className="input mono"
            value={key}
            aria-invalid={!keyValid}
            onChange={(e) => setKey(e.target.value)}
          />
          <span className={keyValid || key === '' ? 'hint' : 'error-text'}>{C.keyHint}</span>
        </div>
        <div className="field">
          <label className="label" htmlFor="workflow-name">
            {C.name}
          </label>
          <input id="workflow-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {target.mode === 'create' && (
          <div className="field">
            <label className="label" htmlFor="workflow-planning">
              {C.planning}
            </label>
            <select
              id="workflow-planning"
              className="select"
              value={planning}
              onChange={(e) =>
                setPlanning(e.target.value === WorkflowPlanning.Ai ? WorkflowPlanning.Ai : WorkflowPlanning.Fixed)
              }
            >
              {Object.values(WorkflowPlanning).map((p) => (
                <option key={p} value={p}>
                  {WORKFLOW_PLANNING_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
        )}
        {create.isError && <ErrorState error={create.error} />}
        <div className="row">
          <Button type="submit" variant="primary" pending={create.isPending} disabled={!keyValid || name.trim() === ''}>
            {COMMON_COPY.confirm}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeleteWorkflowDialog({ workflow, onClose }: { workflow: WorkflowSummaryDTO; onClose: () => void }) {
  const remove = useDeleteWorkflow();
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={C.deleteTitle(workflow.name)}
      footer={
        <Button
          variant="danger"
          pending={remove.isPending}
          onClick={() =>
            remove.mutate(workflow.key, {
              onSuccess: () => {
                toast(C.deleted);
                onClose();
              },
            })
          }
        >
          {C.delete}
        </Button>
      }
    >
      <p>{C.deleteBody}</p>
      {remove.isError && <ErrorState error={remove.error} />}
    </Dialog>
  );
}

/** Workflows (M5-05, 14 §1): built-in ones to copy, custom ones to edit or delete. */
export function WorkflowsPage() {
  const workflows = useQuery(workflowsQuery);
  const [target, setTarget] = useState<Target | undefined>(undefined);
  const [deleting, setDeleting] = useState<WorkflowSummaryDTO | undefined>(undefined);
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{C.title}</h1>
          <p className="lede">{C.lede}</p>
        </div>
        {/* Composition templates chain workflows in phases (34 §15.6): their page sits beside this one. */}
        <Link to={ROUTES.initiativeTemplates} className="btn secondary">
          <Icon name="split" />
          {INITIATIVE_TEMPLATES_COPY.entry}
        </Link>
        <Button variant="primary" icon="plus" onClick={() => setTarget({ mode: 'create' })}>
          {C.create}
        </Button>
      </div>
      {workflows.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {workflows.isError && <ErrorState error={workflows.error} onRetry={() => void workflows.refetch()} />}
      <div className="grid-2">
        {workflows.data?.map((w) => (
          <article key={w.id} className="card pad col" data-testid={`workflow-${w.key}`} aria-label={w.name}>
            <span className="row">
              <span className="tile">
                <Icon name={workflowIcon(w.key)} />
              </span>
              <span className="section-title grow ellipsis">{w.name}</span>
              <span className="chip">{WORKFLOW_KIND_LABEL[w.kind]}</span>
            </span>
            <span className="hint">{w.description}</span>
            <span className="hint">
              {WORKFLOW_PLANNING_LABEL[w.planning]} · {WORKFLOW_DELIVERABLE_LABEL[w.deliverable]} ·{' '}
              {C.version(w.version)}
            </span>
            {/* Up to five actions: they wrap rather than leave the card in a narrow window. */}
            <div className="row wrap">
              <Link to={ROUTES.workflow} params={{ key: w.key }} className="btn secondary sm">
                {w.kind === WorkflowKind.Builtin ? C.view : C.edit}
              </Link>
              <Button size="sm" icon="copy" onClick={() => setTarget({ mode: 'copy', from: w })}>
                {C.copy}
              </Button>
              {w.planning === WorkflowPlanning.Fixed && (
                <>
                  <Link to={ROUTES.batchNew} search={{ workflow: w.key }} className="btn ghost sm">
                    {BATCHES_COPY.runAsBatch}
                  </Link>
                  <Link to={ROUTES.scheduleNew} search={{ workflow: w.key }} className="btn ghost sm">
                    {SCHEDULES_COPY.runOnSchedule}
                  </Link>
                </>
              )}
              {w.kind === WorkflowKind.Custom && (
                <Button size="sm" variant="ghost" icon="trash" onClick={() => setDeleting(w)}>
                  {C.delete}
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
      {target !== undefined && <NewWorkflowDialog target={target} onClose={() => setTarget(undefined)} />}
      {deleting !== undefined && <DeleteWorkflowDialog workflow={deleting} onClose={() => setDeleting(undefined)} />}
    </div>
  );
}
