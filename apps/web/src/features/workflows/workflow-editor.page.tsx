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
import type { ReactNode } from 'react';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { AcceptanceEditor } from '../../canvas/acceptance-editor.tsx';
import { EditTools } from '../../canvas/edit-tools.tsx';
import { checkPlan, type EditorProblem } from '../../canvas/plan-check.ts';
import editorStyles from '../../canvas/plan-editor.module.css';
import { PlanEditor } from '../../canvas/plan-editor.tsx';
import { ProblemCount } from '../../canvas/problem-count.tsx';
import { ProgressCanvas } from '../../canvas/progress-canvas.tsx';
import { useHistory } from '../../canvas/use-history.ts';
import { Button } from '../../components/button.tsx';
import { EmptyState } from '../../components/empty-state.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Panel } from '../../components/panel.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY, formatDateTime } from '../../copy/common.ts';
import { CANVAS_COPY, PLAN_EDITOR_COPY, PLAN_PROBLEM_LABEL, WORKFLOW_PROBLEM_LABEL } from '../../copy/plan-editor.ts';
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

type Draft = { name: string; description: string; definition: WorkflowDefinition };

/** 流程设置 (26 §6.3): everything about the workflow except its steps. */
function Settings({
  workflow,
  roles,
  draft,
  onChange,
  readonly,
}: {
  workflow: WorkflowDTO;
  roles: readonly RoleDTO[];
  draft: Draft;
  onChange: (patch: Partial<Draft>, mergeKey?: string) => void;
  readonly: boolean;
}) {
  const { definition } = draft;
  const patch = (changes: Partial<WorkflowDefinition>, mergeKey?: string) =>
    onChange({ definition: { ...definition, ...changes } }, mergeKey);
  return (
    <fieldset className="col" disabled={readonly} data-testid="workflow-settings">
      <div className="field">
        <label className="label" htmlFor="workflow-edit-description">
          {WORKFLOWS_COPY.description}
        </label>
        <textarea
          id="workflow-edit-description"
          className="textarea"
          rows={2}
          value={draft.description}
          onChange={(e) => onChange({ description: e.target.value }, 'description')}
        />
        <span className="hint">
          {WORKFLOWS_COPY.planning}：{WORKFLOW_PLANNING_LABEL[workflow.planning]} · {WORKFLOWS_COPY.deliverable}：
          {WORKFLOW_DELIVERABLE_LABEL[workflow.deliverable]} · <span className="mono">{workflow.key}</span>
        </span>
      </div>
      <fieldset className={`field ${styles.roles}`}>
        <legend className="label">{C.roles}</legend>
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
      <fieldset className="field">
        <legend className="label">{C.checkpoints}</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={definition.checkpoints.confirm_plan}
            onChange={(e) => patch({ checkpoints: { ...definition.checkpoints, confirm_plan: e.target.checked } })}
          />
          <span>{C.confirmPlan}</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={definition.checkpoints.accept_each_node}
            onChange={(e) => patch({ checkpoints: { ...definition.checkpoints, accept_each_node: e.target.checked } })}
          />
          <span>{C.acceptEachNode}</span>
        </label>
        <span className="hint">{C.checkpointsHint}</span>
      </fieldset>
      <div className="field">
        <span className="label">{C.defaultAcceptance}</span>
        <span className="hint">{C.defaultAcceptanceHint}</span>
        <AcceptanceEditor
          idPrefix="workflow-default"
          value={definition.defaultAcceptance}
          onChange={(acceptance) => acceptance !== undefined && patch({ defaultAcceptance: acceptance })}
          allowDefault={false}
        />
      </div>
      {workflow.planning === WorkflowPlanning.Ai && (
        <>
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
              aria-describedby="workflow-guidance-hint"
              onChange={(e) => {
                const { plannerGuidance: _old, ...rest } = definition;
                onChange(
                  { definition: e.target.value === '' ? rest : { ...rest, plannerGuidance: e.target.value } },
                  'guidance',
                );
              }}
            />
            <span id="workflow-guidance-hint" className="hint">
              {C.guidanceHint}
            </span>
          </div>
        </>
      )}
      <Versions workflowKey={workflow.key} />
    </fieldset>
  );
}

/**
 * Editing one workflow (M5-05, 13 §5), canvas first (26 §6.3, D107): the toolbar, the steps on the canvas and a side
 * panel with the selected step and 流程设置. A built-in workflow is shown read-only. Saving adds a version.
 */
function WorkflowEditor({ workflow, roles }: { workflow: WorkflowDTO; roles: readonly RoleDTO[] }) {
  const readonly = workflow.kind === WorkflowKind.Builtin;
  const update = useUpdateWorkflow();
  const history = useHistory<Draft>({
    name: workflow.name,
    description: workflow.description,
    definition: workflow.definition,
  });
  const draft = history.value;
  const { definition } = draft;
  const change = (patch: Partial<Draft>, mergeKey?: string) => history.change({ ...draft, ...patch }, mergeKey);
  const fixed = workflow.planning === WorkflowPlanning.Fixed;
  const template = definition.template ?? { nodes: [] };
  const templateRules = { allowedRoles: definition.allowedRoles, requiredSteps: [] };
  const templateProblems = fixed ? checkPlan(template, templateRules, undefined) : [];
  // Template problems come from the plan check; the rest of the definition's problems from here.
  const definitionProblems = validateWorkflowDefinition({ planning: workflow.planning, definition }, roles).filter(
    (p) => !fixed || p.field !== 'template',
  );
  const incomplete = (definition.requiredSteps ?? []).some(
    (s) => s.title.trim() === '' || s.instructions.trim() === '',
  );
  const problems: EditorProblem[] = [
    ...(draft.name.trim() === '' ? [{ key: undefined, message: C.nameRequired }] : []),
    ...definitionProblems.map((p) => ({ key: p.nodeKey, message: problemLabel(p) })),
    ...templateProblems,
    ...(incomplete ? [{ key: undefined, message: C.requiredIncomplete }] : []),
  ];
  const save = () =>
    update.mutate(
      { id: workflow.id, name: draft.name.trim(), description: draft.description, definition },
      { onSuccess: (saved) => toast(C.saved(saved.version)) },
    );

  const toolbar = (tools: ReactNode) => (
    <>
      <Link to={ROUTES.workflows} className="crumbs">
        {C.back}
      </Link>
      <h1 className="sr">{draft.name}</h1>
      <input
        className={`input ${styles.name}`}
        aria-label={WORKFLOWS_COPY.name}
        value={draft.name}
        readOnly={readonly}
        onChange={(e) => change({ name: e.target.value }, 'name')}
      />
      <span className="badge st-accent">
        {readonly
          ? C.builtinBadge
          : `${WORKFLOW_PLANNING_LABEL[workflow.planning]} · ${WORKFLOWS_COPY.version(workflow.version)}`}
      </span>
      <span className="grow" />
      {readonly ? (
        <span className="hint">{C.readonly}</span>
      ) : (
        <>
          {history.changes > 0 && <span className="hint">{C.unsaved(history.changes)}</span>}
          {tools}
          <ProblemCount count={problems.length} />
          <Button
            variant="primary"
            size="sm"
            icon="check"
            pending={update.isPending}
            disabled={problems.length > 0 || history.changes === 0}
            onClick={save}
          >
            {C.save}
          </Button>
        </>
      )}
    </>
  );
  const problemList = (
    <div className="col">
      {problems.length === 0 ? (
        <p className="hint">{C.noProblems}</p>
      ) : (
        <ul className={styles.problems} data-testid="workflow-problems">
          {problems.map((p) => (
            <li key={`${p.key}-${p.message}`}>{p.message}</li>
          ))}
        </ul>
      )}
      {update.isError && <ErrorState error={update.error} />}
    </div>
  );
  const settings = <Settings workflow={workflow} roles={roles} draft={draft} onChange={change} readonly={readonly} />;

  if (!fixed) {
    return (
      <RequiredStepsEditor
        steps={definition.requiredSteps ?? []}
        onChange={(requiredSteps, mergeKey) => change({ definition: { ...definition, requiredSteps } }, mergeKey)}
        readonly={readonly}
        allowedRoles={definition.allowedRoles}
        roles={roles}
        toolbar={(addStep) => toolbar(<EditTools history={history} addStep={addStep} />)}
        settings={settings}
        problems={problemList}
      />
    );
  }
  if (readonly) {
    return (
      <div className={editorStyles.editor}>
        <div className={editorStyles.toolbar}>{toolbar(null)}</div>
        <div className={editorStyles.layout}>
          <div className={editorStyles.canvas}>
            <ProgressCanvas steps={stepsOfPlan(template, roles)} label={CANVAS_COPY.workflowLabel} />
          </div>
          <aside className={editorStyles.side}>
            <Panel title={PLAN_EDITOR_COPY.settings}>{settings}</Panel>
          </aside>
        </div>
      </div>
    );
  }
  return (
    <PlanEditor
      label={CANVAS_COPY.workflowLabel}
      history={{
        value: template,
        change: (graph: PlanGraph, mergeKey?: string) =>
          change({ definition: { ...definition, template: graph } }, mergeKey),
        undo: history.undo,
        canUndo: history.canUndo,
      }}
      rules={templateRules}
      roles={roles}
      problems={problems}
      toolbar={(addStep) => toolbar(<EditTools history={history} addStep={addStep} />)}
      actions={update.isError ? <ErrorState error={update.error} /> : undefined}
      settings={settings}
    />
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
