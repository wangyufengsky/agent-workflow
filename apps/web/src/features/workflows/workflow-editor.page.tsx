import {
  type PlanGraph,
  planProblemCodeSchema,
  type RoleDTO,
  validateWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowDTO,
  WorkflowKind,
  WorkflowPlanning,
  type WorkflowProblem,
  workflowProblemCodeSchema,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { AcceptanceEditor } from '../../canvas/acceptance-editor.tsx';
import { checkPlan } from '../../canvas/plan-check.ts';
import { PlanEditor } from '../../canvas/plan-editor.tsx';
import { ProgressCanvas } from '../../canvas/progress-canvas.tsx';
import { Button } from '../../components/button.tsx';
import { EmptyState } from '../../components/empty-state.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Panel } from '../../components/panel.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY, formatDateTime } from '../../copy/common.ts';
import { PLAN_PROBLEM_LABEL, WORKFLOW_PROBLEM_LABEL } from '../../copy/plan-editor.ts';
import {
  WORKFLOW_EDITOR_COPY as C,
  WORKFLOW_DELIVERABLE_LABEL,
  WORKFLOW_PLANNING_LABEL,
  WORKFLOWS_COPY,
} from '../../copy/workflows.ts';
import { stepsOfPlan } from '../task-detail/steps.ts';
import {
  rolesQuery,
  useUpdateWorkflow,
  workflowQuery,
  workflowsQuery,
  workflowVersionsQuery,
} from '../tasks/tasks.queries.ts';
import { RequiredStepsEditor } from './required-steps-editor.tsx';
import styles from './workflows.module.css';

const route = getRouteApi(ROUTE_IDS.workflow);

function problemLabel(problem: WorkflowProblem): string {
  const workflowCode = workflowProblemCodeSchema.safeParse(problem.code);
  const label = workflowCode.success
    ? WORKFLOW_PROBLEM_LABEL[workflowCode.data]
    : PLAN_PROBLEM_LABEL[planProblemCodeSchema.parse(problem.code)];
  return problem.nodeKey === undefined ? label : `${label}（${problem.nodeKey}）`;
}

function Versions({ workflowKey }: { workflowKey: string }) {
  const versions = useQuery(workflowVersionsQuery(workflowKey));
  return (
    <Panel title={C.versions}>
      {versions.isError && <ErrorState error={versions.error} />}
      <ul className={styles.versions}>
        {versions.data?.map((v, index) => (
          <li key={v.id} className="row">
            <span className="grow">{WORKFLOWS_COPY.version(v.version)}</span>
            {index === 0 && <span className="chip">{C.latest}</span>}
            <span className="hint">{formatDateTime(v.createdAt)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Editing one workflow (M5-05, 13 §5); a built-in one is shown read-only. Saving adds a version. */
function WorkflowEditor({ workflow, roles }: { workflow: WorkflowDTO; roles: readonly RoleDTO[] }) {
  const readonly = workflow.kind === WorkflowKind.Builtin;
  const update = useUpdateWorkflow();
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description);
  const [definition, setDefinition] = useState<WorkflowDefinition>(workflow.definition);
  const patch = (changes: Partial<WorkflowDefinition>) => setDefinition({ ...definition, ...changes });
  const fixed = workflow.planning === WorkflowPlanning.Fixed;
  const template = definition.template ?? { nodes: [] };
  const templateRules = { allowedRoles: definition.allowedRoles, requiredSteps: [] };
  const templateProblems = fixed ? checkPlan(template, templateRules, undefined) : [];
  // Template problems show in the plan editor; the rest of the definition's problems here.
  const problems = validateWorkflowDefinition({ planning: workflow.planning, definition }, roles).filter(
    (p) => !fixed || p.field !== 'template',
  );
  const incomplete = (definition.requiredSteps ?? []).some(
    (s) => s.title.trim() === '' || s.instructions.trim() === '',
  );
  const canSave =
    !readonly && name.trim() !== '' && problems.length === 0 && templateProblems.length === 0 && !incomplete;
  const save = () =>
    update.mutate(
      { id: workflow.id, name: name.trim(), description, definition },
      { onSuccess: (saved) => toast(C.saved(saved.version)) },
    );

  return (
    <div className="col">
      {readonly && (
        <div className="banner">
          <span className="grow">{C.readonly}</span>
        </div>
      )}
      <div className={styles.layout}>
        <fieldset className="col" disabled={readonly}>
          <Panel title={C.basics}>
            <div className="col">
              <div className="field">
                <label className="label" htmlFor="workflow-edit-name">
                  {WORKFLOWS_COPY.name}
                </label>
                <input
                  id="workflow-edit-name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="workflow-edit-description">
                  {WORKFLOWS_COPY.description}
                </label>
                <textarea
                  id="workflow-edit-description"
                  className="textarea"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <span className="hint">
                {WORKFLOWS_COPY.planning}：{WORKFLOW_PLANNING_LABEL[workflow.planning]} · {WORKFLOWS_COPY.deliverable}：
                {WORKFLOW_DELIVERABLE_LABEL[workflow.deliverable]} · <span className="mono">{workflow.key}</span>
              </span>
            </div>
          </Panel>
          <Panel title={C.roles}>
            <fieldset className={styles.roles} aria-label={C.roles}>
              {roles.map((role) => (
                <label key={role.key} className="check">
                  <input
                    type="checkbox"
                    checked={definition.allowedRoles.includes(role.key)}
                    onChange={(e) =>
                      patch({
                        allowedRoles: e.target.checked
                          ? [...definition.allowedRoles, role.key]
                          : definition.allowedRoles.filter((k) => k !== role.key),
                      })
                    }
                  />
                  <span>{role.name}</span>
                </label>
              ))}
            </fieldset>
          </Panel>
          <Panel title={C.checkpoints}>
            <div className="col">
              <label className="check">
                <input
                  type="checkbox"
                  checked={definition.checkpoints.confirm_plan}
                  onChange={(e) =>
                    patch({ checkpoints: { ...definition.checkpoints, confirm_plan: e.target.checked } })
                  }
                />
                <span>{C.confirmPlan}</span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={definition.checkpoints.accept_each_node}
                  onChange={(e) =>
                    patch({ checkpoints: { ...definition.checkpoints, accept_each_node: e.target.checked } })
                  }
                />
                <span>{C.acceptEachNode}</span>
              </label>
              <h3 className="sec-t">{C.defaultAcceptance}</h3>
              <AcceptanceEditor
                idPrefix="workflow-default"
                value={definition.defaultAcceptance}
                onChange={(acceptance) => acceptance !== undefined && patch({ defaultAcceptance: acceptance })}
                allowDefault={false}
              />
            </div>
          </Panel>
          {!fixed && (
            <Panel title={C.planner}>
              <div className="col">
                <div className="field">
                  <label className="label" htmlFor="workflow-planner">
                    {C.plannerRole}
                  </label>
                  <select
                    id="workflow-planner"
                    className="select"
                    value={definition.plannerRole ?? ''}
                    onChange={(e) => patch({ plannerRole: e.target.value })}
                  >
                    {roles.map((role) => (
                      <option key={role.key} value={role.key}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="label" htmlFor="workflow-guidance">
                    {C.guidance}
                  </label>
                  <textarea
                    id="workflow-guidance"
                    className="textarea"
                    rows={6}
                    placeholder={C.guidancePlaceholder}
                    value={definition.plannerGuidance ?? ''}
                    onChange={(e) => {
                      const { plannerGuidance: _old, ...rest } = definition;
                      setDefinition(e.target.value === '' ? rest : { ...rest, plannerGuidance: e.target.value });
                    }}
                  />
                </div>
                <h3 className="sec-t">{C.requiredSteps}</h3>
                <RequiredStepsEditor
                  steps={definition.requiredSteps ?? []}
                  onChange={(requiredSteps) => patch({ requiredSteps })}
                  allowedRoles={definition.allowedRoles}
                  roles={roles}
                />
              </div>
            </Panel>
          )}
        </fieldset>
        <aside className="col">
          <Panel title={C.problems}>
            <div className="col">
              {problems.length === 0 ? (
                <p className="hint">{C.noProblems}</p>
              ) : (
                <ul className={styles.problems} data-testid="workflow-problems">
                  {problems.map((p) => (
                    <li key={`${p.field}-${p.code}-${p.nodeKey}-${p.message}`}>{problemLabel(p)}</li>
                  ))}
                </ul>
              )}
              {update.isError && <ErrorState error={update.error} />}
              {!readonly && (
                <Button variant="primary" icon="check" pending={update.isPending} disabled={!canSave} onClick={save}>
                  {C.save}
                </Button>
              )}
            </div>
          </Panel>
          <Versions workflowKey={workflow.key} />
        </aside>
      </div>
      {fixed && (
        <section className="section">
          <h2 className="section-title">{C.template}</h2>
          {readonly ? (
            <div className={styles.readonlyCanvas}>
              <ProgressCanvas steps={stepsOfPlan(template, roles)} />
            </div>
          ) : (
            <PlanEditor
              graph={template}
              onChange={(graph: PlanGraph) => patch({ template: graph })}
              rules={templateRules}
              roles={roles}
              problems={templateProblems}
            />
          )}
        </section>
      )}
    </div>
  );
}

/** `/workflows/:key`: the latest version of a listed workflow. */
export function WorkflowEditorPage() {
  const { key } = route.useParams();
  const list = useQuery(workflowsQuery);
  const summary = list.data?.find((w) => w.key === key);
  const workflow = useQuery({ ...workflowQuery(summary?.id ?? ''), enabled: summary !== undefined });
  const roles = useQuery(rolesQuery);
  const error = list.error ?? workflow.error ?? roles.error;
  return (
    <div className="page wide">
      <div className="page-head">
        <div className="grow col">
          <Link to={ROUTES.workflows} className="crumbs">
            {C.back}
          </Link>
          <h1 className="title">{workflow.data?.name ?? key}</h1>
        </div>
      </div>
      {error !== null && <ErrorState error={error} />}
      {list.data !== undefined && summary === undefined && <EmptyState icon="flow" title={C.notFound} />}
      {(workflow.isPending || roles.isPending) && summary !== undefined && (
        <p className="hint">{COMMON_COPY.loading}</p>
      )}
      {workflow.data !== undefined && roles.data !== undefined && (
        // A saved version is a new row: the editor starts again from it.
        <WorkflowEditor key={workflow.data.id} workflow={workflow.data} roles={roles.data} />
      )}
    </div>
  );
}
